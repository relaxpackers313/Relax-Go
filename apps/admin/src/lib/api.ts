'use client';

/** Typed fetch client for the Relax Go API. Token lives in localStorage; 401 sends the admin back to login. */

const TOKEN_KEY = 'relaxgo_admin_token';
const ADMIN_KEY = 'relaxgo_admin_user';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export const getToken = (): string | null => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY));
export const getAdmin = (): AdminUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ADMIN_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
};
export function setSession(token: string, admin: AdminUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  }).catch(() => {
    throw new ApiClientError(0, 'network', 'Cannot reach the server. Is the API running?');
  });

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    clearSession();
    window.location.href = '/login';
    throw new ApiClientError(401, 'unauthorized', 'Session expired');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
  if (!res.ok) {
    throw new ApiClientError(res.status, data.error?.code ?? 'error', data.error?.message ?? `Request failed (${res.status})`, data.error?.fields);
  }
  return data as T;
}

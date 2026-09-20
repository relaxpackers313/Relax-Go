import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/**
 * API client for the anonymous customer session (spec §72): the first launch creates a
 * session server-side; the long-lived token lives in SecureStore. No signup, ever.
 */
export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://10.0.2.2:4100/api/v1';
export const SOCKET_URL: string = (Constants.expoConfig?.extra?.socketUrl as string) ?? 'http://10.0.2.2:4100';

const TOKEN_KEY = 'relaxgo_session_token';
let cachedToken: string | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function getSessionToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const stored = await SecureStore.getItemAsync(TOKEN_KEY);
  if (stored) {
    cachedToken = stored;
    return stored;
  }
  return createSession();
}

async function createSession(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/customer/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceInfo: { platform: 'android', appVersion: Constants.expoConfig?.version ?? '1.0.0' } }),
  });
  if (!res.ok) throw new ApiError(res.status, 'session', 'Could not start a session. Check your connection.');
  const data = (await res.json()) as { token: string };
  cachedToken = data.token;
  await SecureStore.setItemAsync(TOKEN_KEY, data.token);
  return data.token;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getSessionToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${token}`,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  }).catch(() => {
    throw new ApiError(0, 'network', 'Cannot reach Relax Go. Check your internet connection.');
  });

  if (res.status === 401) {
    // Session invalidated server-side → start a fresh anonymous session once and retry.
    cachedToken = null;
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await createSession();
    return api(path, options);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'error', data.error?.message ?? 'Something went wrong', data.error?.fields);
  return data as T;
}

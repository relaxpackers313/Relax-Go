import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://10.0.2.2:4100/api/v1';
export const SOCKET_URL: string = (Constants.expoConfig?.extra?.socketUrl as string) ?? 'http://10.0.2.2:4100';

const TOKEN_KEY = 'relaxgo_driver_token';
let cachedToken: string | null = null;
let onLogout: (() => void) | null = null;

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

export function setLogoutHandler(fn: () => void): void {
  onLogout = fn;
}

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  return cachedToken;
}

export async function setToken(token: string): Promise<void> {
  cachedToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  }).catch(() => {
    throw new ApiError(0, 'network', 'Cannot reach Relax Go. Check your internet connection.');
  });

  if (res.status === 401 && !path.startsWith('/auth/')) {
    await clearToken();
    onLogout?.();
    throw new ApiError(401, 'unauthorized', 'Please sign in again');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'error', data.error?.message ?? 'Something went wrong', data.error?.fields);
  return data as T;
}

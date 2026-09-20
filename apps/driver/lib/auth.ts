import { api, setToken } from './api';

export interface DriverSession {
  token: string;
  isNew: boolean;
  driver: { id: string; phone: string; status: string; statusReason: string | null; fullName: string | null; registrationSubmitted: boolean };
}

/**
 * Driver auth. Default mode is phone + password — no external dependency; the phone stays
 * the driver's identity and ownership is effectively checked during document review.
 * Firebase phone-OTP remains available when the admin switches auth.driverAuthMode to
 * 'firebase' (requires a build with @react-native-firebase reinstalled + google-services.json).
 */

async function store(session: DriverSession): Promise<DriverSession> {
  await setToken(session.token);
  return session;
}

export async function passwordSignup(phone: string, password: string): Promise<DriverSession> {
  return store(await api<DriverSession>('/auth/driver/signup', { method: 'POST', body: { phone, password } }));
}

export async function passwordLogin(phone: string, password: string): Promise<DriverSession> {
  return store(await api<DriverSession>('/auth/driver/login', { method: 'POST', body: { phone, password } }));
}

// --- Firebase mode (optional; kept behind the config switch) ---

export type PhoneSignIn =
  | { kind: 'firebase'; confirm: (code: string) => Promise<string> }
  | { kind: 'dev'; idToken: string };

export async function startPhoneSignIn(phone: string): Promise<PhoneSignIn> {
  try {
    // Resolved only in builds that include the native module.
    const mod = '@react-native-firebase/auth';
    const { getAuth, signInWithPhoneNumber } = (await import(mod)) as unknown as {
      getAuth: () => unknown;
      signInWithPhoneNumber: (auth: unknown, phone: string) => Promise<{ confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } } | null> }>;
    };
    const confirmation = await signInWithPhoneNumber(getAuth(), phone);
    return {
      kind: 'firebase',
      confirm: async (code: string) => {
        const cred = await confirmation.confirm(code);
        const idToken = await cred?.user.getIdToken();
        if (!idToken) throw new Error('OTP verification failed');
        return idToken;
      },
    };
  } catch (err) {
    // Native module missing → development fallback. Production API refuses dev tokens.
    if (err instanceof Error && /RNFB|native module|No Firebase|Cannot find module|Unable to resolve/i.test(err.message)) {
      return { kind: 'dev', idToken: `dev:${phone}` };
    }
    throw err;
  }
}

export async function exchangeForSession(idToken: string): Promise<DriverSession> {
  return store(await api<DriverSession>('/auth/driver/firebase', { method: 'POST', body: { idToken } }));
}

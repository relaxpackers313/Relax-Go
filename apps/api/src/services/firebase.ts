import { ApiError } from '../lib/errors';
import { env, isProd } from '../config/env';
import { logger } from '../lib/logger';

export interface VerifiedPhoneToken {
  uid: string;
  phone: string;
}

type Verifier = (idToken: string) => Promise<VerifiedPhoneToken>;

let verifier: Verifier | null = null;

async function firebaseVerifier(): Promise<Verifier> {
  const admin = await import('firebase-admin');
  if (!admin.apps.length) {
    const raw = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64!, 'base64').toString('utf8');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return async (idToken: string) => {
    const decoded = await admin.auth().verifyIdToken(idToken).catch(() => null);
    if (!decoded?.phone_number) throw ApiError.unauthorized('Phone verification failed');
    return { uid: decoded.uid, phone: decoded.phone_number };
  };
}

/**
 * Verify a Firebase Phone Auth ID token server-side. In development/test without Firebase
 * credentials, a token of the form `dev:+91XXXXXXXXXX` is accepted so flows stay testable;
 * production REQUIRES the real service account.
 */
export async function verifyPhoneIdToken(idToken: string): Promise<VerifiedPhoneToken> {
  // The dev seam is gated by ENVIRONMENT, not by credential presence: outside production,
  // `dev:+<phone>` tokens work even when Firebase is configured (seeding, local app builds
  // without google-services.json). Production always requires a real Firebase token.
  if (!isProd && idToken.startsWith('dev:+')) {
    const phone = idToken.slice(4);
    if (!/^\+\d{10,15}$/.test(phone)) throw ApiError.unauthorized('Invalid dev token phone');
    return { uid: `dev-${phone}`, phone };
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    verifier ??= await firebaseVerifier();
    return verifier(idToken);
  }
  if (isProd) {
    logger.error('FIREBASE_SERVICE_ACCOUNT_BASE64 missing in production');
    throw ApiError.unauthorized('Phone verification unavailable');
  }
  throw ApiError.unauthorized('Phone verification failed');
}

/** Test seam. */
export function _setVerifierForTests(fn: Verifier | null): void {
  verifier = fn;
}

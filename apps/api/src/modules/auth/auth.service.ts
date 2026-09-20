import { AdminUser } from '../../models/admin.model';
import { Driver } from '../../models/driver.model';
import { CustomerSession } from '../../models/customer.model';
import { Wallet } from '../../models/wallet.model';
import { hashPassword, verifyPassword } from '../../lib/passwords';
import { signAccessToken, signCustomerToken } from '../../lib/tokens';
import { ApiError } from '../../lib/errors';
import { verifyPhoneIdToken } from '../../services/firebase';
import { audit } from '../../lib/audit';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

export async function bootstrapAdmin(): Promise<void> {
  const count = await AdminUser.estimatedDocumentCount();
  if (count > 0) return;
  if (!env.ADMIN_BOOTSTRAP_EMAIL || !env.ADMIN_BOOTSTRAP_PASSWORD) {
    logger.warn('no admin users and no ADMIN_BOOTSTRAP_EMAIL/PASSWORD set — admin panel unusable until seeded');
    return;
  }
  await AdminUser.create({
    email: env.ADMIN_BOOTSTRAP_EMAIL,
    passwordHash: await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD),
    name: 'Bootstrap Admin',
    role: 'superadmin',
  });
  logger.info({ email: env.ADMIN_BOOTSTRAP_EMAIL }, 'bootstrap superadmin created');
}

export async function adminLogin(email: string, password: string) {
  const admin = await AdminUser.findOne({ email: email.toLowerCase() });
  // Uniform error whether the account or the password is wrong.
  if (!admin || !admin.active || !(await verifyPassword(password, admin.passwordHash))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  admin.lastLoginAt = new Date();
  await admin.save();
  return {
    token: signAccessToken({ sub: String(admin._id), kind: 'admin' }, 12 * 3600),
    admin: { id: String(admin._id), email: admin.email, name: admin.name, role: admin.role, permissions: admin.permissions },
  };
}

/**
 * Driver sign-in: Firebase Phone ID token verified server-side; first sign-in creates the
 * driver in `pending` with an empty wallet. Approval alone unlocks operations (spec §10).
 */
export async function driverFirebaseLogin(idToken: string) {
  const { uid, phone } = await verifyPhoneIdToken(idToken);
  let driver = await Driver.findOne({ firebaseUid: uid });
  let isNew = false;
  if (!driver) {
    const byPhone = await Driver.findOne({ phone });
    if (byPhone) throw ApiError.conflict('This phone number is already registered with another sign-in');
    driver = await Driver.create({ firebaseUid: uid, phone, status: 'pending' });
    await Wallet.create({ driverId: driver._id });
    await audit({ actor: { kind: 'driver', id: String(driver._id) }, action: 'driver.signup', target: { kind: 'driver', id: String(driver._id) } });
    isNew = true;
  }
  if (driver.status === 'blocked') throw ApiError.forbidden('Account blocked. Contact support.');
  return {
    token: signAccessToken({ sub: String(driver._id), kind: 'driver' }, 7 * 24 * 3600),
    isNew,
    driver: {
      id: String(driver._id),
      phone: driver.phone,
      status: driver.status,
      statusReason: driver.statusReason ?? null,
      fullName: driver.fullName ?? null,
      registrationSubmitted: !!driver.registrationSubmittedAt,
    },
  };
}

interface DriverLike {
  _id: unknown;
  phone: string;
  status: string;
  statusReason?: string | null;
  fullName?: string | null;
  registrationSubmittedAt?: Date | null;
}

function driverSessionPayload(driver: DriverLike, isNew: boolean) {
  return {
    token: signAccessToken({ sub: String(driver._id), kind: 'driver' }, 7 * 24 * 3600),
    isNew,
    driver: {
      id: String(driver._id),
      phone: driver.phone,
      status: driver.status,
      statusReason: driver.statusReason ?? null,
      fullName: driver.fullName ?? null,
      registrationSubmitted: !!driver.registrationSubmittedAt,
    },
  };
}

/**
 * Phone + password driver auth — the default mode (no external dependency). The phone stays
 * the driver's identity; ownership is effectively verified during document review, and
 * password resets go through admin support until an SMS channel exists.
 */
export async function driverPasswordSignup(phone: string, password: string) {
  const existing = await Driver.findOne({ phone });
  if (existing) {
    throw ApiError.conflict(existing.passwordHash ? 'This number is already registered — sign in instead' : 'This number is registered with OTP sign-in. Contact support.');
  }
  const driver = await Driver.create({
    phone,
    firebaseUid: `pw:${phone}`,
    passwordHash: await hashPassword(password),
    status: 'pending',
  });
  await Wallet.create({ driverId: driver._id });
  await audit({ actor: { kind: 'driver', id: String(driver._id) }, action: 'driver.signup', target: { kind: 'driver', id: String(driver._id) } });
  return driverSessionPayload(driver, true);
}

export async function driverPasswordLogin(phone: string, password: string) {
  const driver = await Driver.findOne({ phone });
  // Uniform error whether the number or the password is wrong.
  if (!driver?.passwordHash || !(await verifyPassword(password, driver.passwordHash))) {
    throw ApiError.unauthorized('Wrong number or password');
  }
  if (driver.status === 'blocked') throw ApiError.forbidden('Account blocked. Contact support.');
  return driverSessionPayload(driver, false);
}

/** Anonymous customer session (spec §72) — no signup, just a session identity. */
export async function createCustomerSession(deviceInfo?: { platform?: 'android' | 'ios' | 'web'; model?: string; appVersion?: string }) {
  const session = await CustomerSession.create({ deviceInfo });
  return { token: signCustomerToken(String(session._id)), sessionId: String(session._id) };
}

import request from 'supertest';
import type { Express } from 'express';

export const BASE = '/api/v1';

export async function adminToken(app: Express): Promise<string> {
  const { bootstrapAdmin } = await import('../modules/auth/auth.service');
  await bootstrapAdmin();
  const res = await request(app)
    .post(`${BASE}/auth/admin/login`)
    .send({ email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export async function driverToken(app: Express, phone: string): Promise<{ token: string; driverId: string }> {
  const res = await request(app).post(`${BASE}/auth/driver/firebase`).send({ idToken: `dev:${phone}` });
  if (res.status !== 200) throw new Error(`driver login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, driverId: res.body.driver.id as string };
}

export async function customerToken(app: Express): Promise<string> {
  const res = await request(app).post(`${BASE}/auth/customer/session`).send({ deviceInfo: { platform: 'android' } });
  if (res.status !== 201) throw new Error(`customer session failed: ${res.status}`);
  return res.body.token as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Register + upload all required documents + approve a driver, returning their token. Positions them at [lat,lng] if given. */
export async function approvedDriver(
  app: Express,
  opts: { phone: string; vehicleType?: string; at?: { lat: number; lng: number }; adminTok?: string },
): Promise<{ token: string; driverId: string }> {
  const admin = opts.adminTok ?? (await adminToken(app));
  const { token, driverId } = await driverToken(app, opts.phone);

  await request(app)
    .put(`${BASE}/driver/registration`)
    .set(auth(token))
    .send({
      fullName: `Driver ${opts.phone.slice(-4)}`,
      address: 'Test Lane, Cuttack',
      city: 'Cuttack',
      emergencyContact: { name: 'Kin', phone: '+919999999999' },
      vehicle: { type: opts.vehicleType ?? 'auto', registrationNumber: `OD05${opts.phone.slice(-4)}`, model: 'Test Model' },
    })
    .expect(200);

  const state = await request(app).get(`${BASE}/driver/registration`).set(auth(token)).expect(200);
  for (const doc of state.body.documents.filter((d: { required: boolean }) => d.required)) {
    await request(app)
      .post(`${BASE}/driver/documents`)
      .set(auth(token))
      .send({ type: doc.type, fileUrl: 'https://example.com/doc.jpg', expiresAt: '2030-01-01' })
      .expect(201);
  }
  await request(app).post(`${BASE}/admin/drivers/${driverId}/decision`).set(auth(admin)).send({ action: 'approve' }).expect(200);

  if (opts.at) {
    await request(app).post(`${BASE}/driver/presence`).set(auth(token)).send({ online: true }).expect(200);
    await request(app)
      .post(`${BASE}/driver/locations`)
      .set(auth(token))
      .send({ points: [{ lat: opts.at.lat, lng: opts.at.lng, accuracy: 10, recordedAt: new Date().toISOString(), source: 'foreground' }] })
      .expect(200);
  }
  return { token, driverId };
}

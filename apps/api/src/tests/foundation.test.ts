import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { BASE, adminToken, approvedDriver, auth, customerToken, driverToken } from './helpers';

// Cuttack area coordinates for geo tests.
const CUSTOMER = { lat: 20.4625, lng: 85.8828 };
const NEAR = { lat: 20.47, lng: 85.89 }; // ~1.2 km
const FAR = { lat: 20.6, lng: 86.0 }; // ~19.5 km
const BEYOND_50KM = { lat: 21.0, lng: 86.4 }; // ~80 km

let app: Express;
let adminTok: string;

beforeAll(async () => {
  const { createApp } = await import('../app');
  app = createApp();
  adminTok = await adminToken(app);
});

describe('platform settings engine', () => {
  it('serves defaults, applies audited patches and bumps the version', async () => {
    const initial = await request(app).get(`${BASE}/admin/settings`).set(auth(adminTok)).expect(200);
    expect(initial.body.settings.discovery.maxRadiusKm).toBe(50);
    expect(initial.body.settings.brand.operator).toBe('Relax Group');

    const patched = await request(app)
      .patch(`${BASE}/admin/settings`)
      .set(auth(adminTok))
      .send({ patch: { discovery: { defaultRadiusKm: 15 } }, reason: 'ops tuning' })
      .expect(200);
    expect(patched.body.settings.discovery.defaultRadiusKm).toBe(15);
    expect(patched.body.version).toBe(initial.body.version + 1);

    const { AuditLog } = await import('../models/ops.model');
    const entry = await AuditLog.findOne({ action: 'settings.update' }).sort({ createdAt: -1 });
    expect(entry?.before).toMatchObject({ 'discovery.defaultRadiusKm': 10 });
    expect(entry?.after).toMatchObject({ 'discovery.defaultRadiusKm': 15 });

    await request(app)
      .patch(`${BASE}/admin/settings`)
      .set(auth(adminTok))
      .send({ patch: { discovery: { maxRadiusKm: -5 } } })
      .expect(422);
  });

  it('exposes only the public slice without auth', async () => {
    const res = await request(app).get(`${BASE}/config`).expect(200);
    expect(res.body.brand.productName).toBe('Relax Go');
    expect(res.body.vehicleTypes.length).toBeGreaterThan(0);
    expect(res.body.brand.supportEmail).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('basePricePaise'); // pricing is not public
  });
});

describe('driver password auth (default mode)', () => {
  it('signs up with phone+password, signs in, rejects wrong credentials and duplicates', async () => {
    const signup = await request(app).post(`${BASE}/auth/driver/signup`).send({ phone: '9555500001', password: 'secret-pass-1' }).expect(201);
    expect(signup.body.isNew).toBe(true);
    expect(signup.body.driver.phone).toBe('+919555500001'); // +91 normalised
    expect(signup.body.driver.status).toBe('pending');

    // Duplicate number → clear conflict.
    await request(app).post(`${BASE}/auth/driver/signup`).send({ phone: '+919555500001', password: 'another-pass-1' }).expect(409);

    // Wrong password and unknown number give the same uniform error.
    const bad = await request(app).post(`${BASE}/auth/driver/login`).send({ phone: '+919555500001', password: 'wrong-password' }).expect(401);
    const unknown = await request(app).post(`${BASE}/auth/driver/login`).send({ phone: '+919555599999', password: 'whatever-123' }).expect(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);

    const login = await request(app).post(`${BASE}/auth/driver/login`).send({ phone: '9555500001', password: 'secret-pass-1' }).expect(200);
    expect(login.body.driver.id).toBe(signup.body.driver.id);
    await request(app).get(`${BASE}/driver/me`).set(auth(login.body.token)).expect(200);

    // Admin resets the password (audited support-desk flow).
    await request(app)
      .post(`${BASE}/admin/drivers/${signup.body.driver.id}/reset-password`)
      .set(auth(adminTok))
      .send({ password: 'new-pass-word-1' })
      .expect(200);
    await request(app).post(`${BASE}/auth/driver/login`).send({ phone: '+919555500001', password: 'secret-pass-1' }).expect(401);
    await request(app).post(`${BASE}/auth/driver/login`).send({ phone: '+919555500001', password: 'new-pass-word-1' }).expect(200);
    const { AuditLog } = await import('../models/ops.model');
    expect(await AuditLog.findOne({ action: 'driver.password_reset', 'target.id': signup.body.driver.id })).toBeTruthy();

    // Public config announces the auth mode to the apps.
    const cfg = await request(app).get(`${BASE}/config`).expect(200);
    expect(cfg.body.auth.driverAuthMode).toBe('phone_password');
  });
});

describe('driver onboarding and approval gate', () => {
  it('walks signup → registration → documents → approval, blocking operations until approved', async () => {
    const { token, driverId } = await driverToken(app, '+919000000001');

    // Not approved: operational endpoints are forbidden, status endpoints work.
    await request(app).post(`${BASE}/driver/presence`).set(auth(token)).send({ online: true }).expect(403);
    const me = await request(app).get(`${BASE}/driver/me`).set(auth(token)).expect(200);
    expect(me.body.status).toBe('pending');

    await request(app)
      .put(`${BASE}/driver/registration`)
      .set(auth(token))
      .send({
        fullName: 'Ramesh Kumar',
        address: '12 Station Road, Cuttack',
        city: 'Cuttack',
        emergencyContact: { name: 'Suresh', phone: '+919888888888' },
        vehicle: { type: 'auto', registrationNumber: 'od05ab1234', model: 'Bajaj RE' },
      })
      .expect(200);

    // Approval refused while required documents are missing.
    const early = await request(app).post(`${BASE}/admin/drivers/${driverId}/decision`).set(auth(adminTok)).send({ action: 'approve' });
    expect(early.status).toBe(409);

    const state = await request(app).get(`${BASE}/driver/registration`).set(auth(token)).expect(200);
    for (const doc of state.body.documents.filter((d: { required: boolean }) => d.required)) {
      await request(app)
        .post(`${BASE}/driver/documents`)
        .set(auth(token))
        .send({ type: doc.type, fileUrl: 'https://example.com/d.jpg', expiresAt: '2030-01-01' })
        .expect(201);
    }

    // Rejection requires a reason.
    await request(app).post(`${BASE}/admin/drivers/${driverId}/decision`).set(auth(adminTok)).send({ action: 'reject' }).expect(422);

    await request(app).post(`${BASE}/admin/drivers/${driverId}/decision`).set(auth(adminTok)).send({ action: 'approve' }).expect(200);

    const after = await request(app).get(`${BASE}/driver/me`).set(auth(token)).expect(200);
    expect(after.body.status).toBe('approved');
    // Welcome free credits from config (default 50) landed through the ledger.
    expect(after.body.wallet.freeCredits).toBe(50);
    const { WalletTransaction } = await import('../models/wallet.model');
    const grant = await WalletTransaction.findOne({ driverId, kind: 'free_credit_grant' });
    expect(grant?.credits).toBe(50);

    // Now operational.
    await request(app).post(`${BASE}/driver/presence`).set(auth(token)).send({ online: true }).expect(200);

    // Suspension kicks the driver out of operations and audits it.
    await request(app).post(`${BASE}/admin/drivers/${driverId}/decision`).set(auth(adminTok)).send({ action: 'suspend', reason: 'complaint' }).expect(200);
    await request(app).post(`${BASE}/driver/presence`).set(auth(token)).send({ online: true }).expect(403);
    const { AuditLog } = await import('../models/ops.model');
    expect(await AuditLog.findOne({ action: 'driver.suspend', 'target.id': driverId })).toBeTruthy();
  });
});

describe('geospatial discovery', () => {
  it('returns only approved, online, fresh drivers inside the radius, nearest first', async () => {
    const a = await approvedDriver(app, { phone: '+919000000011', at: NEAR, adminTok });
    const b = await approvedDriver(app, { phone: '+919000000012', at: FAR, adminTok });
    await approvedDriver(app, { phone: '+919000000013', at: BEYOND_50KM, adminTok }); // beyond max radius
    const offline = await approvedDriver(app, { phone: '+919000000014', at: NEAR, adminTok });
    await request(app).post(`${BASE}/driver/presence`).set(auth(offline.token)).send({ online: false }).expect(200);

    const customer = await customerToken(app);
    const res = await request(app)
      .get(`${BASE}/customer/drivers/nearby`)
      .set(auth(customer))
      .query({ lat: CUSTOMER.lat, lng: CUSTOMER.lng, radiusKm: 50 })
      .expect(200);

    const ids = res.body.drivers.map((d: { driverId: string }) => d.driverId);
    expect(ids).toContain(a.driverId);
    expect(ids).toContain(b.driverId);
    expect(ids).not.toContain(offline.driverId);
    expect(res.body.drivers.length).toBeGreaterThanOrEqual(2);

    // Nearest → farthest and distances are sane.
    const distances = res.body.drivers.map((d: { distanceKm: number }) => d.distanceKm);
    expect([...distances].sort((x: number, y: number) => x - y)).toEqual(distances);
    const nearRow = res.body.drivers.find((d: { driverId: string }) => d.driverId === a.driverId);
    expect(nearRow.distanceKm).toBeGreaterThan(0.5);
    expect(nearRow.distanceKm).toBeLessThan(3);

    // Radius clamp: nobody beyond the configured max even when the client asks for more.
    const wide = await request(app)
      .get(`${BASE}/customer/drivers/nearby`)
      .set(auth(customer))
      .query({ lat: CUSTOMER.lat, lng: CUSTOMER.lng, radiusKm: 5000 })
      .expect(200);
    expect(wide.body.radiusKm).toBe(50);
    const wideDistances = wide.body.drivers.map((d: { distanceKm: number }) => d.distanceKm);
    for (const dist of wideDistances) expect(dist).toBeLessThanOrEqual(50);

    // Vehicle filter.
    const bikes = await request(app)
      .get(`${BASE}/customer/drivers/nearby`)
      .set(auth(customer))
      .query({ lat: CUSTOMER.lat, lng: CUSTOMER.lng, vehicleType: 'bike' })
      .expect(200);
    expect(bikes.body.drivers.find((d: { driverId: string }) => d.driverId === a.driverId)).toBeUndefined();
  });

  it('rejects implausible GPS points and keeps history sampled', async () => {
    const d = await approvedDriver(app, { phone: '+919000000021', at: NEAR, adminTok });
    const now = Date.now();
    const res = await request(app)
      .post(`${BASE}/driver/locations`)
      .set(auth(d.token))
      .send({
        points: [
          { lat: NEAR.lat + 0.001, lng: NEAR.lng, accuracy: 10, recordedAt: new Date(now + 1000).toISOString(), source: 'foreground' },
          // Teleport ~1000 km in 2 seconds → rejected.
          { lat: 28.6, lng: 77.2, accuracy: 10, recordedAt: new Date(now + 2000).toISOString(), source: 'foreground' },
          // Terrible accuracy → rejected.
          { lat: NEAR.lat, lng: NEAR.lng, accuracy: 5000, recordedAt: new Date(now + 3000).toISOString(), source: 'foreground' },
        ],
      })
      .expect(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toBe(2);
  });

  it('flags a driver for review after a batch dominated by implausible points', async () => {
    const d = await approvedDriver(app, { phone: '+919000000022', at: NEAR, adminTok });
    const now = Date.now();
    // 6 teleporting points (Delhi/Mumbai/Kolkata hops within seconds) → all rejected → flag.
    const cities = [[28.6, 77.2], [19.07, 72.87], [22.57, 88.36], [13.08, 80.27], [26.9, 75.8], [17.38, 78.48]];
    const res = await request(app)
      .post(`${BASE}/driver/locations`)
      .set(auth(d.token))
      .send({ points: cities.map(([lat, lng], i) => ({ lat, lng, accuracy: 10, recordedAt: new Date(now + (i + 1) * 1000).toISOString(), source: 'foreground' as const })) })
      .expect(200);
    expect(res.body.rejected).toBe(6);
    const { Driver } = await import('../models/driver.model');
    const flagged = await Driver.findById(d.driverId);
    expect(flagged?.flags).toContain('gps_anomalies');
    const { AuditLog } = await import('../models/ops.model');
    expect(await AuditLog.findOne({ action: 'driver.flag', 'target.id': d.driverId })).toBeTruthy();

    // Admin clears the flag after review.
    await request(app).post(`${BASE}/admin/drivers/${d.driverId}/flags`).set(auth(adminTok)).send({ flag: 'gps_anomalies', action: 'remove' }).expect(200);
    expect((await Driver.findById(d.driverId))?.flags).not.toContain('gps_anomalies');
  });
});

describe('leads', () => {
  it('creates a lead, notifies the driver, walks the status graph and blocks duplicates', async () => {
    const d = await approvedDriver(app, { phone: '+919000000031', at: NEAR, adminTok });
    const customer = await customerToken(app);

    const created = await request(app)
      .post(`${BASE}/customer/leads`)
      .set(auth(customer))
      .send({ driverId: d.driverId, pickup: { ...CUSTOMER, address: 'College Square' }, vehicleType: 'auto' })
      .expect(201);
    expect(created.body.status).toBe('created');
    expect(created.body.distanceKm).toBeGreaterThan(0.5);

    // Duplicate within the window → 409.
    await request(app)
      .post(`${BASE}/customer/leads`)
      .set(auth(customer))
      .send({ driverId: d.driverId, pickup: CUSTOMER, vehicleType: 'auto' })
      .expect(409);

    // Driver list shows it (created → shown), then views and accepts.
    const list = await request(app).get(`${BASE}/driver/leads`).set(auth(d.token)).expect(200);
    const mine = list.body.items.find((l: { _id: string }) => l._id === created.body._id);
    expect(mine.status).toBe('shown');

    await request(app).post(`${BASE}/driver/leads/${mine._id}/action`).set(auth(d.token)).send({ action: 'viewed' }).expect(200);
    await request(app).post(`${BASE}/driver/leads/${mine._id}/action`).set(auth(d.token)).send({ action: 'accept' }).expect(200);

    // Illegal transition (accept again → accepted→accepted not allowed).
    await request(app).post(`${BASE}/driver/leads/${mine._id}/action`).set(auth(d.token)).send({ action: 'accept' }).expect(409);

    const seen = await request(app).get(`${BASE}/customer/leads/${mine._id}`).set(auth(customer)).expect(200);
    expect(seen.body.status).toBe('accepted');
    expect(seen.body.statusHistory.map((s: { status: string }) => s.status)).toEqual(['created', 'shown', 'viewed', 'accepted']);

    const { Notification } = await import('../models/ops.model');
    expect(await Notification.findOne({ type: 'lead.new', 'audience.id': d.driverId })).toBeTruthy();
  });

  it('one customer cannot read another customer’s lead', async () => {
    const d = await approvedDriver(app, { phone: '+919000000041', at: NEAR, adminTok });
    const c1 = await customerToken(app);
    const c2 = await customerToken(app);
    const lead = await request(app)
      .post(`${BASE}/customer/leads`)
      .set(auth(c1))
      .send({ driverId: d.driverId, pickup: CUSTOMER, vehicleType: 'auto' })
      .expect(201);
    await request(app).get(`${BASE}/customer/leads/${lead.body._id}`).set(auth(c2)).expect(404);
  });
});

describe('authorization boundaries', () => {
  it('rejects wrong principals and missing permissions', async () => {
    const customer = await customerToken(app);
    await request(app).get(`${BASE}/admin/settings`).set(auth(customer)).expect(403);
    await request(app).get(`${BASE}/admin/settings`).expect(401);
    const { token } = await driverToken(app, '+919000000051');
    await request(app).get(`${BASE}/customer/drivers/nearby`).set(auth(token)).query({ lat: 20, lng: 85 }).expect(403);
  });
});

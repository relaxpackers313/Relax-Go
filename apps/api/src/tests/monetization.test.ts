import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import type { Express } from 'express';
import { BASE, adminToken, approvedDriver, auth, customerToken } from './helpers';
import { _setGatewayForTests, type PaymentGateway } from '../services/payments/gateway';

const AT = { lat: 20.47, lng: 85.89 };
const PICKUP = { lat: 20.4625, lng: 85.8828, address: 'Buxi Bazaar' };

let app: Express;
let adminTok: string;

/** Deterministic fake gateway with real HMAC signatures, so verification logic is truly exercised. */
const SECRET = 'test-gateway-secret';
const sig = (orderId: string, paymentId: string) => createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex');
let orderSeq = 0;
const fakeGateway: PaymentGateway = {
  name: 'fake',
  async createOrder({ amountPaise }) {
    return { gatewayOrderId: `order_${++orderSeq}`, amountPaise, currency: 'INR', clientData: { keyId: 'fake' } };
  },
  verifyPayment({ orderId, paymentId, signature }) {
    return signature === sig(orderId, paymentId);
  },
  verifyWebhook(rawBody, signature) {
    const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    if (expected !== signature) return { valid: false };
    const p = JSON.parse(rawBody);
    return { valid: true, event: p.event, orderId: p.orderId, paymentId: p.paymentId };
  },
};

async function makeLead(customer: string, driverId: string, phone = '+919777000001') {
  const res = await request(app)
    .post(`${BASE}/customer/leads`)
    .set(auth(customer))
    .send({ driverId, pickup: PICKUP, vehicleType: 'auto', contactPhone: phone })
    .expect(201);
  return res.body._id as string;
}

beforeAll(async () => {
  const { createApp } = await import('../app');
  app = createApp();
  adminTok = await adminToken(app);
  _setGatewayForTests(fakeGateway);
  // Deterministic billing for tests: no daily allowance, 2 welcome credits, ₹2 base price.
  await request(app)
    .patch(`${BASE}/admin/settings`)
    .set(auth(adminTok))
    .send({ patch: { calls: { freeCallsPerDay: 0, freeCreditsOnApproval: 2, basePricePaise: 200, duplicateCallWindowMinutes: 0 }, leads: { duplicateWindowMinutes: 0, maxActivePerCustomer: 100 } } })
    .expect(200);
});

describe('call billing engine', () => {
  it('consumes free credits, then charges the wallet, then refuses with the product message', async () => {
    const d = await approvedDriver(app, { phone: '+919100000001', at: AT, adminTok });
    const customer = await customerToken(app);

    // 2 welcome credits → 2 free calls, each on a separate lead.
    for (let i = 0; i < 2; i++) {
      const leadId = await makeLead(customer, d.driverId);
      const call = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId }).expect(201);
      expect(call.body.charge.classification).toBe('free');
      expect(call.body.phone).toBe('+919777000001');
    }

    // Credits exhausted, wallet empty → 402 with the exact spec message.
    const lead3 = await makeLead(customer, d.driverId);
    const refused = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId: lead3 }).expect(402);
    expect(refused.body.error.message).toBe('You have no call credits available. Add money to your wallet to continue.');

    // Admin adds ₹10 → next call charges ₹2 and the ledger explains it.
    await request(app)
      .post(`${BASE}/admin/wallets/${d.driverId}/adjust`)
      .set(auth(adminTok))
      .send({ kind: 'balance', amount: 1000, reason: 'test top-up' })
      .expect(200);
    const paid = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId: lead3 }).expect(201);
    expect(paid.body.charge).toMatchObject({ classification: 'paid', amountPaise: 200, settled: true });

    const wallet = await request(app).get(`${BASE}/driver/wallet`).set(auth(d.token)).expect(200);
    expect(wallet.body).toMatchObject({ balancePaise: 800, freeCredits: 0 });

    const txs = await request(app).get(`${BASE}/driver/wallet/transactions`).set(auth(d.token)).expect(200);
    const kinds = txs.body.items.map((t: { kind: string }) => t.kind);
    expect(kinds).toContain('call_charge');
    expect(kinds.filter((k: string) => k === 'free_credit_consume')).toHaveLength(2);
    const charge = txs.body.items.find((t: { kind: string }) => t.kind === 'call_charge');
    expect(charge.balanceAfterPaise).toBe(800);

    // The customer's number never appears in driver lead payloads — only via calls.
    const leads = await request(app).get(`${BASE}/driver/leads`).set(auth(d.token)).expect(200);
    expect(JSON.stringify(leads.body)).not.toContain('+919777000001');
  });

  it('daily allowance is used before stored credits, and pricing rules beat the base price', async () => {
    await request(app)
      .patch(`${BASE}/admin/settings`)
      .set(auth(adminTok))
      .send({ patch: { calls: { freeCallsPerDay: 1 } } })
      .expect(200);
    const d = await approvedDriver(app, { phone: '+919100000002', at: AT, adminTok });
    const customer = await customerToken(app);

    // Vehicle-specific rule: auto leads cost ₹5.
    const rule = await request(app)
      .post(`${BASE}/admin/pricing-rules`)
      .set(auth(adminTok))
      .send({ name: 'Auto leads ₹5', priority: 10, match: { vehicleType: 'auto' }, pricePaise: 500 })
      .expect(201);

    const lead1 = await makeLead(customer, d.driverId);
    const first = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId: lead1 }).expect(201);
    expect(first.body.charge.classification).toBe('free'); // daily allowance

    // Allowance done → welcome credits (2) → then paid at the RULE price.
    for (let i = 0; i < 2; i++) {
      const leadId = await makeLead(customer, d.driverId);
      const r = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId }).expect(201);
      expect(r.body.charge.classification).toBe('free');
    }
    await request(app).post(`${BASE}/admin/wallets/${d.driverId}/adjust`).set(auth(adminTok)).send({ kind: 'balance', amount: 1000, reason: 'top-up' }).expect(200);
    const leadPaid = await makeLead(customer, d.driverId);
    const paid = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId: leadPaid }).expect(201);
    expect(paid.body.charge.amountPaise).toBe(500);

    await request(app).delete(`${BASE}/admin/pricing-rules/${rule.body._id}`).set(auth(adminTok)).expect(200);
    await request(app).patch(`${BASE}/admin/settings`).set(auth(adminTok)).send({ patch: { calls: { freeCallsPerDay: 0 } } }).expect(200);
  });

  it('repeat calls inside the duplicate window are not charged again', async () => {
    await request(app).patch(`${BASE}/admin/settings`).set(auth(adminTok)).send({ patch: { calls: { duplicateCallWindowMinutes: 15 } } }).expect(200);
    const d = await approvedDriver(app, { phone: '+919100000003', at: AT, adminTok });
    const customer = await customerToken(app);
    const leadId = await makeLead(customer, d.driverId);

    const first = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId }).expect(201);
    expect(first.body.charge.classification).toBe('free');
    const redial = await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId }).expect(201);
    expect(redial.body.charge.classification).toBe('unbilled');

    // Outcome reporting closes the call.
    await request(app).post(`${BASE}/driver/calls/${first.body.callId}/outcome`).set(auth(d.token)).send({ status: 'completed', durationSeconds: 45 }).expect(200);
    await request(app).patch(`${BASE}/admin/settings`).set(auth(adminTok)).send({ patch: { calls: { duplicateCallWindowMinutes: 0 } } }).expect(200);
  });
});

describe('customer click-to-call', () => {
  it('creates the lead, bills the driver, reveals the driver number, and refuses politely when the driver is out of credits', async () => {
    const d = await approvedDriver(app, { phone: '+919100000077', at: AT, adminTok });
    const customer = await customerToken(app);

    // 2 welcome credits → two billable click-to-calls succeed.
    const first = await request(app)
      .post(`${BASE}/customer/calls`)
      .set(auth(customer))
      .send({ driverId: d.driverId, pickup: PICKUP, vehicleType: 'auto' })
      .expect(201);
    expect(first.body.phone).toBe('+919100000077');
    expect(first.body.leadId).toBeTruthy();

    // The auto-created lead is already 'contacted' and visible to both sides.
    const lead = await request(app).get(`${BASE}/customer/leads/${first.body.leadId}`).set(auth(customer)).expect(200);
    expect(lead.body.status).toBe('contacted');
    expect(lead.body.driver.name).toContain('Driver');

    const second = await request(app)
      .post(`${BASE}/customer/calls`)
      .set(auth(customer))
      .send({ driverId: d.driverId, pickup: PICKUP, vehicleType: 'auto' })
      .expect(201);
    expect(second.body.phone).toBe('+919100000077');

    const wallet = await request(app).get(`${BASE}/driver/wallet`).set(auth(d.token)).expect(200);
    expect(wallet.body.freeCredits).toBe(0);

    // Credits gone, wallet empty → the customer gets a pick-another-driver message, not the driver's wallet error.
    const refused = await request(app)
      .post(`${BASE}/customer/calls`)
      .set(auth(customer))
      .send({ driverId: d.driverId, pickup: PICKUP, vehicleType: 'auto' })
      .expect(409);
    expect(refused.body.error.message).toContain('pick another driver');
  });
});

describe('wallet recharge (verified server-side, idempotent)', () => {
  it('credits only after signature verification, and a duplicate webhook cannot double-credit', async () => {
    const d = await approvedDriver(app, { phone: '+919100000011', at: AT, adminTok });

    // Below the minimum → 422.
    await request(app).post(`${BASE}/driver/wallet/recharge`).set(auth(d.token)).send({ amountPaise: 100 }).expect(422);

    const created = await request(app).post(`${BASE}/driver/wallet/recharge`).set(auth(d.token)).send({ amountPaise: 10000 }).expect(201);
    const orderId = created.body.order.gatewayOrderId as string;

    // Tampered signature → rejected, nothing credited.
    await request(app)
      .post(`${BASE}/driver/wallet/recharge/verify`)
      .set(auth(d.token))
      .send({ orderId, paymentId: 'pay_1', signature: 'bad' })
      .expect(401);

    // The failed attempt marks the payment failed; create a fresh order and verify correctly.
    const created2 = await request(app).post(`${BASE}/driver/wallet/recharge`).set(auth(d.token)).send({ amountPaise: 10000 }).expect(201);
    const orderId2 = created2.body.order.gatewayOrderId as string;
    const ok = await request(app)
      .post(`${BASE}/driver/wallet/recharge/verify`)
      .set(auth(d.token))
      .send({ orderId: orderId2, paymentId: 'pay_2', signature: sig(orderId2, 'pay_2') })
      .expect(200);
    expect(ok.body.wallet.balancePaise).toBe(10000);

    // A late duplicate webhook for the same payment is a no-op.
    const body = JSON.stringify({ event: 'payment.captured', orderId: orderId2, paymentId: 'pay_2' });
    const whSig = createHmac('sha256', SECRET).update(body).digest('hex');
    await request(app).post(`${BASE}/webhooks/payments/razorpay`).set('x-razorpay-signature', whSig).set('content-type', 'application/json').send(body).expect(200);
    const wallet = await request(app).get(`${BASE}/driver/wallet`).set(auth(d.token)).expect(200);
    expect(wallet.body.balancePaise).toBe(10000);

    // Invalid webhook signature → 401.
    await request(app).post(`${BASE}/webhooks/payments/razorpay`).set('x-razorpay-signature', 'nope').send(body).expect(401);
  });

  it('admin adjustments cannot push a wallet negative', async () => {
    const d = await approvedDriver(app, { phone: '+919100000012', at: AT, adminTok });
    await request(app)
      .post(`${BASE}/admin/wallets/${d.driverId}/adjust`)
      .set(auth(adminTok))
      .send({ kind: 'balance', amount: -5000, reason: 'should fail' })
      .expect(422);
  });
});

describe('trips, ratings, support', () => {
  it('runs contact → trip → completion → rating, updating the driver aggregate', async () => {
    const d = await approvedDriver(app, { phone: '+919100000021', at: AT, adminTok });
    const customer = await customerToken(app);
    const leadId = await makeLead(customer, d.driverId);
    await request(app).post(`${BASE}/driver/calls`).set(auth(d.token)).send({ leadId }).expect(201);

    const trip = await request(app).post(`${BASE}/driver/trips/from-lead/${leadId}`).set(auth(d.token)).expect(201);
    expect(trip.body.shareToken).toBeTruthy();

    // Public share view works without any auth and hides contact details.
    const shared = await request(app).get(`${BASE}/shared/trips/${trip.body.shareToken}`).expect(200);
    expect(shared.body.driver.registrationNumber).toBeTruthy();
    expect(JSON.stringify(shared.body)).not.toContain('+9197');

    for (const action of ['en_route', 'arrived', 'start', 'complete']) {
      await request(app).post(`${BASE}/driver/trips/${trip.body._id}/action`).set(auth(d.token)).send({ action }).expect(200);
    }
    // Backwards transition refused.
    await request(app).post(`${BASE}/driver/trips/${trip.body._id}/action`).set(auth(d.token)).send({ action: 'start' }).expect(409);

    const rated = await request(app).post(`${BASE}/customer/leads/${leadId}/rating`).set(auth(customer)).send({ stars: 5, review: 'Quick and polite' }).expect(201);
    expect(rated.body.average).toBe(5);
    await request(app).post(`${BASE}/customer/leads/${leadId}/rating`).set(auth(customer)).send({ stars: 1 }).expect(409);
  });

  it('support tickets flow between driver and admin, with notifications', async () => {
    const d = await approvedDriver(app, { phone: '+919100000022', at: AT, adminTok });
    const ticket = await request(app)
      .post(`${BASE}/support`)
      .set(auth(d.token))
      .send({ category: 'billing', subject: 'Charged twice?', body: 'I think one call charged me twice.' })
      .expect(201);

    await request(app).post(`${BASE}/admin/support/${ticket.body._id}`).set(auth(adminTok)).send({ reply: 'Checked: the second call was unbilled.', status: 'resolved' }).expect(200);

    const mine = await request(app).get(`${BASE}/support`).set(auth(d.token)).expect(200);
    expect(mine.body.items[0].status).toBe('resolved');
    expect(mine.body.items[0].messages).toHaveLength(2);

    const inbox = await request(app).get(`${BASE}/notifications`).set(auth(d.token)).expect(200);
    expect(inbox.body.items.some((n: { type: string }) => n.type === 'support.reply')).toBe(true);
    await request(app).post(`${BASE}/notifications/read`).set(auth(d.token)).send({}).expect(200);
  });

  it('dashboard and reports aggregate the activity', async () => {
    const dash = await request(app).get(`${BASE}/admin/dashboard`).set(auth(adminTok)).expect(200);
    expect(dash.body.drivers.approved).toBeGreaterThan(0);
    expect(dash.body.revenue.callChargesTodayPaise).toBeGreaterThan(0);
    expect(dash.body.walletFloatPaise).toBeGreaterThan(0);

    const report = await request(app).get(`${BASE}/admin/reports/summary`).set(auth(adminTok)).expect(200);
    expect(report.body.revenue.chargedCalls).toBeGreaterThan(0);
    expect(report.body.creditsConsumed.free_credit_consume).toBeGreaterThan(0);
    expect(report.body.leads.contacted ?? 0 + (report.body.leads.converted ?? 0)).toBeGreaterThan(0);
  });
});

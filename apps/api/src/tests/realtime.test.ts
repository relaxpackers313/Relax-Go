import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { BASE, adminToken, approvedDriver, auth, customerToken } from './helpers';

const AT = { lat: 20.47, lng: 85.89 };

let httpServer: HttpServer;
let io: Server;
let url: string;
let app: import('express').Express;
const clients: ClientSocket[] = [];

function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { path: '/realtime', auth: { token }, transports: ['websocket'] });
    clients.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

const waitFor = <T>(socket: ClientSocket, event: string, ms = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

beforeAll(async () => {
  const { createApp } = await import('../app');
  const { initRealtime } = await import('../realtime/gateway');
  app = createApp();
  httpServer = createServer(app);
  io = initRealtime(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('realtime gateway', () => {
  it('rejects unauthenticated sockets', async () => {
    await expect(connect('garbage')).rejects.toThrow();
  });

  it('streams driver locations to watching customers and lead events to drivers', async () => {
    const adminTok = await adminToken(app);
    // No throttle in this test: every accepted update should reach the watcher.
    await request(app).patch(`${BASE}/admin/settings`).set(auth(adminTok)).send({ patch: { location: { realtimeThrottleSeconds: 0 } } }).expect(200);
    const { invalidateSettingsCache } = await import('../modules/settings/settings.service');
    invalidateSettingsCache();
    const d = await approvedDriver(app, { phone: '+919200000001', at: AT, adminTok });
    const customerTok = await customerToken(app);

    const driverSocket = await connect(d.token);
    const customerSocket = await connect(customerTok);

    // Customer watches the driver they can see on the map.
    customerSocket.emit('watch', { driverIds: [d.driverId] });
    await waitFor(customerSocket, 'watching');

    // Driver posts a location over REST → customer receives it over the socket.
    // A plausible move: ~90 m, timestamped 30 s after the setup point, so validation accepts it.
    const locationPromise = waitFor<{ driverId: string; lat: number; serverAt: string }>(customerSocket, 'driver:location');
    const res = await request(app)
      .post(`${BASE}/driver/locations`)
      .set(auth(d.token))
      .send({ points: [{ lat: 20.4708, lng: 85.89, accuracy: 8, recordedAt: new Date(Date.now() + 30_000).toISOString(), source: 'foreground' }] })
      .expect(200);
    expect(res.body.accepted).toBe(1);
    const loc = await locationPromise;
    expect(loc.driverId).toBe(d.driverId);
    expect(loc.lat).toBeCloseTo(20.4708, 3);
    expect(loc.serverAt).toBeTruthy();

    // Customer creates a lead → the driver's socket gets lead:new.
    const leadPromise = waitFor<{ leadId: string }>(driverSocket, 'lead:new');
    const lead = await request(app)
      .post(`${BASE}/customer/leads`)
      .set(auth(customerTok))
      .send({ driverId: d.driverId, pickup: { lat: 20.4625, lng: 85.8828, address: 'Ring Road' }, vehicleType: 'auto', contactPhone: '+919777000002' })
      .expect(201);
    const leadEvent = await leadPromise;
    expect(leadEvent.leadId).toBe(lead.body._id);

    // Driver accepts → the customer's socket gets lead:status.
    const statusPromise = waitFor<{ leadId: string; status: string }>(customerSocket, 'lead:status');
    await request(app).post(`${BASE}/driver/leads/${lead.body._id}/action`).set(auth(d.token)).send({ action: 'accept' }).expect(200);
    const statuses: string[] = [(await statusPromise).status];
    // accept fast-forwards through viewed; take the last observed status.
    while (statuses.at(-1) !== 'accepted') {
      statuses.push((await waitFor<{ status: string }>(customerSocket, 'lead:status')).status);
    }
    expect(statuses).toContain('accepted');

    // Presence change reaches the watcher.
    const presencePromise = waitFor<{ driverId: string; online: boolean }>(customerSocket, 'driver:presence');
    await request(app).post(`${BASE}/driver/presence`).set(auth(d.token)).send({ online: false }).expect(200);
    expect((await presencePromise).online).toBe(false);
  });
});

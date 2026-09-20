// Discovery + location-pipeline load check (Phase 15) against a RUNNING API.
// Seeds N online drivers spread around Cuttack (dev sign-in seam, so dev/test only), then
// fires K discovery requests and M location batches, reporting latency percentiles.
// Usage: ADMIN_PASSWORD=... node scripts/load-test.mjs [drivers=100] [queries=300]
const API = process.env.API ?? 'http://localhost:4100/api/v1';
const N = Number(process.argv[2] ?? 100);
const K = Number(process.argv[3] ?? 300);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@relaxgo.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD (ADMIN_BOOTSTRAP_PASSWORD in apps/api/.env)');
  process.exit(1);
}

const CENTER = { lat: 20.4625, lng: 85.8828 };
const rand = (spread) => (Math.random() - 0.5) * spread;

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error?.message ?? ''}`);
  return data;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const { token: admin } = await call('/auth/admin/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });

// Lift the per-IP ceiling for the duration of the run (restored at the end).
const before = await call('/admin/settings', { token: admin });
const prevCeiling = before.settings.security.apiRequestsPerMinute;
await call('/admin/settings', { method: 'PATCH', token: admin, body: { patch: { security: { apiRequestsPerMinute: 10000, locationUpdatesPerMinute: 10000, leadCreatesPerHour: 10000, otpRequestsPerHour: 2500 } }, reason: 'load test' } });

console.log(`Seeding ${N} online drivers…`);
const driverTokens = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const phone = `+9198888${String(10000 + i).slice(-5)}`;
  const login = await call('/auth/driver/firebase', { method: 'POST', body: { idToken: `dev:${phone}` } });
  if (login.driver.status !== 'approved') {
    await call('/driver/registration', {
      method: 'PUT',
      token: login.token,
      body: { fullName: `Load Driver ${i}`, address: 'Cuttack', city: 'Cuttack', emergencyContact: { name: 'Kin', phone: '+919000000000' }, vehicle: { type: ['auto', 'bike', 'car'][i % 3], registrationNumber: `OD05L${String(1000 + i)}` } },
    });
    const reg = await call('/driver/registration', { token: login.token });
    for (const doc of reg.documents.filter((d) => d.required)) {
      await call('/driver/documents', { method: 'POST', token: login.token, body: { type: doc.type, fileUrl: 'https://example.com/x.jpg', expiresAt: '2030-01-01' } });
    }
    await call(`/admin/drivers/${login.driver.id}/decision`, { method: 'POST', token: admin, body: { action: 'approve' } });
  }
  await call('/driver/presence', { method: 'POST', token: login.token, body: { online: true } });
  await call('/driver/locations', {
    method: 'POST',
    token: login.token,
    body: { points: [{ lat: CENTER.lat + rand(0.4), lng: CENTER.lng + rand(0.4), accuracy: 10, recordedAt: new Date().toISOString(), source: 'foreground' }] },
  });
  driverTokens.push(login.token);
}
console.log(`Seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const { token: customer } = await call('/auth/customer/session', { method: 'POST', body: {} });

console.log(`Firing ${K} discovery queries (batches of 10, mixed with location updates)…`);
const discoveryMs = [];
const locationMs = [];
for (let batch = 0; batch < K / 10; batch++) {
  const jobs = [];
  for (let j = 0; j < 10; j++) {
    jobs.push(
      (async () => {
        const s = performance.now();
        const res = await call(`/customer/drivers/nearby?lat=${CENTER.lat + rand(0.1)}&lng=${CENTER.lng + rand(0.1)}&radiusKm=25`, { token: customer });
        discoveryMs.push(performance.now() - s);
        return res.drivers.length;
      })(),
    );
    // Interleave a driver location update to simulate live load.
    const dt = driverTokens[(batch * 10 + j) % driverTokens.length];
    jobs.push(
      (async () => {
        const s = performance.now();
        await call('/driver/locations', {
          method: 'POST',
          token: dt,
          body: { points: [{ lat: CENTER.lat + rand(0.4), lng: CENTER.lng + rand(0.4), accuracy: 10, recordedAt: new Date().toISOString(), source: 'foreground' }] },
        }).catch(() => undefined); // implausible-jump rejections are fine here
        locationMs.push(performance.now() - s);
      })(),
    );
  }
  await Promise.all(jobs);
}

discoveryMs.sort((a, b) => a - b);
locationMs.sort((a, b) => a - b);
console.log(`\nDiscovery (${discoveryMs.length} reqs): p50 ${pct(discoveryMs, 50).toFixed(0)}ms · p95 ${pct(discoveryMs, 95).toFixed(0)}ms · max ${pct(discoveryMs, 100).toFixed(0)}ms`);
console.log(`Location ingest (${locationMs.length} reqs): p50 ${pct(locationMs, 50).toFixed(0)}ms · p95 ${pct(locationMs, 95).toFixed(0)}ms · max ${pct(locationMs, 100).toFixed(0)}ms`);
await call('/admin/settings', {
  method: 'PATCH',
  token: admin,
  body: {
    patch: { security: { apiRequestsPerMinute: prevCeiling, locationUpdatesPerMinute: before.settings.security.locationUpdatesPerMinute, leadCreatesPerHour: before.settings.security.leadCreatesPerHour, otpRequestsPerHour: before.settings.security.otpRequestsPerHour } },
    reason: 'load test done',
  },
});
console.log('Rate-limit ceilings restored.');

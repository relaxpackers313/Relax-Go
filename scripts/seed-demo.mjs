// Seeds a demo scenario against a RUNNING local API (:4100): three approved drivers around
// Cuttack with live positions, one pending registration, a customer lead and a tracked call.
// Dev only — it uses the dev Firebase token seam, which production refuses.
const API = process.env.API ?? 'http://localhost:4100/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@relaxgo.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD (see ADMIN_BOOTSTRAP_PASSWORD in apps/api/.env)');
  process.exit(1);
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error?.message ?? 'failed'}`);
  return data;
}

const { token: admin } = await call('/auth/admin/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
console.log('admin ok');

const DRIVERS = [
  { phone: '+919812300001', name: 'Santosh Behera', vehicle: 'auto', reg: 'OD05AB1234', at: { lat: 20.468, lng: 85.886 } },
  { phone: '+919812300002', name: 'Prakash Sahoo', vehicle: 'bike', reg: 'OD05CD5678', at: { lat: 20.455, lng: 85.878 } },
  { phone: '+919812300003', name: 'Md. Irfan', vehicle: 'car', reg: 'OD02EF9012', at: { lat: 20.48, lng: 85.9 } },
];

const tokens = {};
for (const d of DRIVERS) {
  const login = await call('/auth/driver/firebase', { method: 'POST', body: { idToken: `dev:${d.phone}` } });
  tokens[d.phone] = login.token;
  if (login.driver.status === 'approved') {
    console.log(`${d.name}: already approved`);
  } else {
    await call('/driver/registration', {
      method: 'PUT',
      token: login.token,
      body: {
        fullName: d.name,
        address: 'Near Netaji Bus Stand, Cuttack',
        city: 'Cuttack',
        emergencyContact: { name: 'Family', phone: '+919900000000' },
        vehicle: { type: d.vehicle, registrationNumber: d.reg, model: d.vehicle === 'auto' ? 'Bajaj RE' : d.vehicle === 'bike' ? 'Hero Splendor' : 'WagonR' },
      },
    });
    const reg = await call('/driver/registration', { token: login.token });
    for (const doc of reg.documents.filter((x) => x.required)) {
      await call('/driver/documents', {
        method: 'POST',
        token: login.token,
        body: { type: doc.type, fileUrl: 'https://placehold.co/600x400?text=demo+document', expiresAt: '2030-01-01' },
      });
    }
    await call(`/admin/drivers/${login.driver.id}/decision`, { method: 'POST', token: admin, body: { action: 'approve' } });
    console.log(`${d.name}: approved`);
  }
  await call('/driver/presence', { method: 'POST', token: tokens[d.phone], body: { online: true } });
  await call('/driver/locations', {
    method: 'POST',
    token: tokens[d.phone],
    body: { points: [{ lat: d.at.lat, lng: d.at.lng, accuracy: 10, recordedAt: new Date().toISOString(), source: 'foreground' }] },
  });
}

// One driver stuck in review, so the approval queue shows something.
const pending = await call('/auth/driver/firebase', { method: 'POST', body: { idToken: 'dev:+919812300009' } });
if (!pending.driver.registrationSubmitted) {
  await call('/driver/registration', {
    method: 'PUT',
    token: pending.token,
    body: {
      fullName: 'Ranjit Kumar Das',
      address: 'Bidanasi, Cuttack',
      city: 'Cuttack',
      emergencyContact: { name: 'Brother', phone: '+919911111111' },
      vehicle: { type: 'auto', registrationNumber: 'OD05ZZ4321', model: 'Piaggio Ape' },
    },
  });
  console.log('pending driver seeded');
}

// A customer discovers drivers, requests the nearest one, and the driver calls back.
const { token: customer } = await call('/auth/customer/session', { method: 'POST', body: { deviceInfo: { platform: 'android', appVersion: '1.0.0' } } });
const nearby = await call('/customer/drivers/nearby?lat=20.4625&lng=85.8828&radiusKm=25', { token: customer });
console.log(`discovery: ${nearby.drivers.length} drivers, nearest ${nearby.drivers[0]?.name} at ${nearby.drivers[0]?.distanceKm} km`);
const target = nearby.drivers[0];
if (target) {
  const lead = await call('/customer/leads', {
    method: 'POST',
    token: customer,
    body: { driverId: target.driverId, pickup: { lat: 20.4625, lng: 85.8828, address: 'College Square, Cuttack' }, vehicleType: target.vehicleType, contactPhone: '+919876543210' },
  });
  const driverToken = Object.values(tokens)[DRIVERS.findIndex((d) => d.reg === target.registrationNumber)] ?? Object.values(tokens)[0];
  await call(`/driver/leads/${lead._id}/action`, { method: 'POST', token: driverToken, body: { action: 'accept' } });
  const callRes = await call('/driver/calls', { method: 'POST', token: driverToken, body: { leadId: lead._id } });
  await call(`/driver/calls/${callRes.callId}/outcome`, { method: 'POST', token: driverToken, body: { status: 'completed', durationSeconds: 42 } });
  console.log(`lead + call seeded (${callRes.charge.message})`);
}

console.log('demo data ready');

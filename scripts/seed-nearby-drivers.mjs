// Seeds a realistic demo fleet around a point: 9 approved drivers (3 bike / 3 auto / 3 car)
// spread 0.4–2.6 km from CENTER, all online with live positions and headings.
// Dev only — uses the dev sign-in seam, which production refuses.
//
//   node scripts/seed-nearby-drivers.mjs                 # seed (or refresh) the fleet once
//   node scripts/seed-nearby-drivers.mjs --keepalive     # then keep their locations fresh
//
// CENTER_LAT / CENTER_LNG env vars override the default (Jayadev Vihar, Bhubaneswar).
const API = process.env.API ?? 'http://localhost:4100/api/v1';
const CENTER = { lat: Number(process.env.CENTER_LAT ?? 20.2983), lng: Number(process.env.CENTER_LNG ?? 85.8177) };
const KEEPALIVE = process.argv.includes('--keepalive');

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

// Offsets in km (east, north) → all within ~0.4–2.6 km of CENTER, spread across directions.
const FLEET = [
  { phone: '+919845600001', name: 'Santosh Behera', vehicle: 'auto', model: 'Bajaj RE Compact', reg: 'OD02AJ4455', off: [0.4, 0.3], heading: 130 },
  { phone: '+919845600002', name: 'Prakash Sahoo', vehicle: 'auto', model: 'Piaggio Ape City', reg: 'OD02BK7788', off: [-0.9, 0.6], heading: 45 },
  { phone: '+919845600003', name: 'Bikash Jena', vehicle: 'auto', model: 'Mahindra Alfa', reg: 'OD33CL2211', off: [1.3, -0.8], heading: 300 },
  { phone: '+919845600004', name: 'Rohit Pradhan', vehicle: 'bike', model: 'Hero Splendor+', reg: 'OD02DM9900', off: [0.2, -0.5], heading: 210 },
  { phone: '+919845600005', name: 'Sk. Nadeem', vehicle: 'bike', model: 'TVS Apache 160', reg: 'OD02EN3344', off: [-1.6, -1.1], heading: 80 },
  { phone: '+919845600006', name: 'Deepak Nayak', vehicle: 'bike', model: 'Bajaj Pulsar 125', reg: 'OD33FP6677', off: [2.0, 1.2], heading: 350 },
  { phone: '+919845600007', name: 'Manas Mohanty', vehicle: 'car', model: 'Maruti WagonR', reg: 'OD02GQ1122', off: [-0.6, -1.9], heading: 15 },
  { phone: '+919845600008', name: 'Ajay Kumar Singh', vehicle: 'car', model: 'Hyundai Aura', reg: 'OD02HR5566', off: [1.1, 1.8], heading: 250 },
  { phone: '+919845600009', name: 'Chittaranjan Swain', vehicle: 'car', model: 'Maruti Dzire', reg: 'OD33JS8899', off: [-2.1, 0.9], heading: 170 },
];

const at = (off) => ({
  lat: CENTER.lat + off[1] / 110.574,
  lng: CENTER.lng + off[0] / (111.32 * Math.cos((CENTER.lat * Math.PI) / 180)),
});

const tokens = {};

async function ensureDriver(d) {
  const login = await call('/auth/driver/firebase', { method: 'POST', body: { idToken: `dev:${d.phone}` } });
  tokens[d.phone] = login.token;
  if (login.driver.status !== 'approved') {
    await call('/driver/registration', {
      method: 'PUT',
      token: login.token,
      body: {
        fullName: d.name,
        address: 'Jayadev Vihar, Bhubaneswar',
        city: 'Bhubaneswar',
        emergencyContact: { name: 'Family', phone: '+919900000000' },
        vehicle: { type: d.vehicle, registrationNumber: d.reg, model: d.model },
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
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@relaxgo.local';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD (see ADMIN_BOOTSTRAP_PASSWORD in apps/api/.env)');
    const { token: admin } = await call('/auth/admin/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    await call(`/admin/drivers/${login.driver.id}/decision`, { method: 'POST', token: admin, body: { action: 'approve' } });
    console.log(`${d.name} (${d.vehicle}): registered + approved`);
  } else {
    console.log(`${d.name} (${d.vehicle}): already approved`);
  }
  await call('/driver/presence', { method: 'POST', token: tokens[d.phone], body: { online: true } });
}

async function pushLocation(d, jitter = 0) {
  const p = at(d.off);
  await call('/driver/locations', {
    method: 'POST',
    token: tokens[d.phone],
    body: {
      points: [
        {
          lat: p.lat + (Math.random() - 0.5) * jitter,
          lng: p.lng + (Math.random() - 0.5) * jitter,
          accuracy: 8,
          heading: (d.heading + Math.round((Math.random() - 0.5) * 20) + 360) % 360,
          speed: 4 + Math.random() * 8,
          recordedAt: new Date().toISOString(),
          source: 'foreground',
        },
      ],
    },
  });
}

for (const d of FLEET) {
  await ensureDriver(d);
  await pushLocation(d);
}
console.log(`fleet of ${FLEET.length} online around ${CENTER.lat},${CENTER.lng}`);

if (KEEPALIVE) {
  console.log('keepalive: refreshing locations every 45s (Ctrl+C to stop)');
  setInterval(() => {
    Promise.all(FLEET.map((d) => pushLocation(d, 0.0006))).catch((e) => console.error('keepalive tick failed:', e.message));
  }, 45_000);
}

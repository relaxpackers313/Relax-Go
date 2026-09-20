// LIVE demo traffic: the 9 seeded drivers drive along REAL roads. Each driver gets a road
// route (Google Routes via our own geo proxy), and every 3s posts the next GPS point through
// the normal driver API — so sockets fire, headings rotate, and the customer map shows them
// gliding exactly like real riders. Ping-pongs along the route forever.
//
//   ADMIN_PASSWORD=... node scripts/drive-demo.mjs          # CENTER_LAT/CENTER_LNG to move the zone
//
// Dev only: uses the dev sign-in seam (production refuses it).
const API = process.env.API ?? 'http://localhost:4100/api/v1';
const CENTER = { lat: Number(process.env.CENTER_LAT ?? 20.3509), lng: Number(process.env.CENTER_LNG ?? 85.8294) };
const TICK_MS = 3000;
const SPEED_KMH = 24; // city speed; also keeps every hop far below the GPS plausibility ceiling
const STEP_M = (SPEED_KMH / 3.6) * (TICK_MS / 1000);

const FLEET = [
  { phone: '+919845600001', off: [0.4, 0.3], leg: [1.4, 0.2] },
  { phone: '+919845600002', off: [-0.9, 0.6], leg: [0.3, -1.5] },
  { phone: '+919845600003', off: [1.3, -0.8], leg: [-1.2, 0.6] },
  { phone: '+919845600004', off: [0.2, -0.5], leg: [1.0, 1.0] },
  { phone: '+919845600005', off: [-1.6, -1.1], leg: [1.6, 0.3] },
  { phone: '+919845600006', off: [2.0, 1.2], leg: [-0.4, -1.6] },
  { phone: '+919845600007', off: [-0.6, -1.9], leg: [-0.8, 1.2] },
  { phone: '+919845600008', off: [1.1, 1.8], leg: [-1.5, -0.5] },
  { phone: '+919845600009', off: [-2.1, 0.9], leg: [1.2, -1.0] },
];

const at = (base, off) => ({
  lat: base.lat + off[1] / 110.574,
  lng: base.lng + off[0] / (111.32 * Math.cos((base.lat * Math.PI) / 180)),
});

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${data.error?.message ?? 'failed'}`), { status: res.status });
  return data;
}

function decodePolyline(encoded) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = encoded.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function distM(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
/** Resample a path into points ~STEP_M apart so one point per tick = constant speed. */
function densify(path, stepM) {
  const out = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1];
    const b = path[i];
    let seg = distM(a, b);
    while (carry + seg >= stepM) {
      const t = (stepM - carry) / seg;
      a = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      out.push(a);
      seg = distM(a, b);
      carry = 0;
    }
    carry += seg;
  }
  out.push(path[path.length - 1]);
  return out;
}

const login = (phone) => call('/auth/driver/firebase', { method: 'POST', body: { idToken: `dev:${phone}` } }).then((r) => r.token);

const { token: customer } = await call('/auth/customer/session', { method: 'POST', body: { deviceInfo: { platform: 'android' } } });

const drivers = [];
for (const d of FLEET) {
  const token = await login(d.phone);
  await call('/driver/presence', { method: 'POST', token, body: { online: true } });
  const from = at(CENTER, d.off);
  const to = at(CENTER, [d.off[0] + d.leg[0], d.off[1] + d.leg[1]]);
  const route = await call(
    `/customer/geo/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}&vehicleType=bike`,
    { token: customer },
  );
  const raw = route.polyline ? decodePolyline(route.polyline) : [from, to];
  const path = densify(raw, STEP_M);
  drivers.push({ ...d, token, path, i: Math.floor(Math.random() * path.length), dir: 1 });
  console.log(`${d.phone}: route ${route.distanceKm} km, ${path.length} steps (${route.provider})`);
}
console.log(`driving ${drivers.length} riders at ~${SPEED_KMH} km/h — Ctrl+C to stop`);

async function tickDriver(d) {
  // Ping-pong along the road.
  let next = d.i + d.dir;
  if (next >= d.path.length || next < 0) {
    d.dir = -d.dir;
    next = d.i + d.dir;
  }
  const cur = d.path[d.i];
  const nxt = d.path[next];
  d.i = next;
  const hdg = d.dir === 1 ? bearing(cur, nxt) : bearing(nxt, cur);
  try {
    await call('/driver/locations', {
      method: 'POST',
      token: d.token,
      body: {
        points: [
          {
            lat: nxt.lat,
            lng: nxt.lng,
            accuracy: 8,
            heading: Math.round(bearing(cur, nxt)),
            speed: SPEED_KMH / 3.6,
            recordedAt: new Date().toISOString(),
            source: 'foreground',
          },
        ],
      },
    });
  } catch (err) {
    if (err.status === 401) {
      // Access token expired (15 min TTL) — sign in again and carry on.
      d.token = await login(d.phone).catch(() => d.token);
    } else if (err.status !== 429) {
      console.error(`${d.phone}: ${err.message}`);
    }
  }
  void hdg;
}

setInterval(() => {
  void Promise.all(drivers.map((d) => tickDriver(d)));
}, TICK_MS);

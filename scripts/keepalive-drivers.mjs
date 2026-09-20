// Keeps the seeded demo fleet's live locations FRESH by touching driverlocations directly in
// Mongo every 45s (discovery drops anything older than the freshness window). Dev tool only —
// it bypasses the API on purpose so it never fights auth token TTLs or rate limits.
//   node scripts/keepalive-drivers.mjs
import { MongoClient } from 'mongodb';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = fs.readFileSync(path.join(here, '../apps/api/.env'), 'utf8');
const uri = envFile.match(/^MONGODB_URI=(.+)$/m)?.[1]?.trim();
if (!uri) throw new Error('MONGODB_URI not found in apps/api/.env');
// Same resolver override the API uses — the local resolver refuses Atlas SRV lookups.
const dnsServers = envFile.match(/^DNS_SERVERS=(.+)$/m)?.[1]?.trim();
if (dnsServers) dns.setServers(dnsServers.split(',').map((s) => s.trim()));

// Same fleet layout as seed-nearby-drivers.mjs: offsets in km (east, north) from CENTER.
const CENTER = { lat: Number(process.env.CENTER_LAT ?? 20.2983), lng: Number(process.env.CENTER_LNG ?? 85.8177) };
const FLEET = [
  { phone: '+919845600001', off: [0.4, 0.3], heading: 130 },
  { phone: '+919845600002', off: [-0.9, 0.6], heading: 45 },
  { phone: '+919845600003', off: [1.3, -0.8], heading: 300 },
  { phone: '+919845600004', off: [0.2, -0.5], heading: 210 },
  { phone: '+919845600005', off: [-1.6, -1.1], heading: 80 },
  { phone: '+919845600006', off: [2.0, 1.2], heading: 350 },
  { phone: '+919845600007', off: [-0.6, -1.9], heading: 15 },
  { phone: '+919845600008', off: [1.1, 1.8], heading: 250 },
  { phone: '+919845600009', off: [-2.1, 0.9], heading: 170 },
];
const FLEET_PHONES = FLEET.map((f) => f.phone);
const at = (off) => ({
  lat: CENTER.lat + off[1] / 110.574,
  lng: CENTER.lng + off[0] / (111.32 * Math.cos((CENTER.lat * Math.PI) / 180)),
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db();
const drivers = await db
  .collection('drivers')
  .find({ phone: { $in: FLEET_PHONES } })
  .project({ _id: 1, phone: 1 })
  .toArray();
console.log(`keepalive: ${drivers.length} fleet drivers, touching locations every 45s (Ctrl+C to stop)`);

async function tick() {
  const now = new Date();
  await Promise.all(
    drivers.map((d) => {
      const f = FLEET.find((x) => x.phone === d.phone);
      const p = at(f.off);
      // Small wander so the fleet looks alive on the map.
      const lat = p.lat + (Math.random() - 0.5) * 0.0008;
      const lng = p.lng + (Math.random() - 0.5) * 0.0008;
      return db.collection('driverlocations').updateOne(
        { driverId: d._id },
        {
          $set: {
            location: { type: 'Point', coordinates: [lng, lat] },
            receivedAt: now,
            recordedAt: now,
            online: true,
            heading: (f.heading + Math.round((Math.random() - 0.5) * 30) + 360) % 360,
          },
        },
      );
    }),
  );
  process.stdout.write('.');
}

await tick();
setInterval(() => void tick().catch((e) => console.error('tick failed:', e.message)), 45_000);

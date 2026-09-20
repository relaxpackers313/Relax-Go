import { haversineKm } from '@relaxgo/shared';
import { DriverLocation, LocationHistory } from '../../models/location.model';
import { getSettings } from '../settings/settings.service';
import { fromGeoPoint, toGeoPoint } from '../../models/geo';
import { events } from '../../lib/events';
import { Driver } from '../../models/driver.model';
import { trusted } from '../../lib/mongo';
import { audit } from '../../lib/audit';

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  battery?: number;
  recordedAt: Date;
  source: 'foreground' | 'background';
}

/**
 * Ingest a batch of GPS points from a driver device. Validates sanity against config,
 * upserts ONE live row, and samples history at most once per configured window
 * (CLAUDE.md rule 5 — never one history row per GPS tick).
 */
export async function ingestLocations(driverId: string, points: LocationPoint[]) {
  const settings = await getSettings();
  const cfg = settings.location;
  const now = Date.now();

  const current = await DriverLocation.findOne({ driverId });
  const prev = current ? { ...fromGeoPoint(current.location as never), at: current.recordedAt.getTime() } : null;

  // Order by device time; evaluate each point against its predecessor.
  const ordered = [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const accepted: LocationPoint[] = [];
  let last = prev;
  let rejected = 0;
  for (const p of ordered) {
    const t = p.recordedAt.getTime();
    const inFuture = t > now + 60_000;
    const badAccuracy = p.accuracy !== undefined && p.accuracy > cfg.maxAccuracyMeters;
    let implausible = false;
    if (last && t > last.at) {
      const km = haversineKm(last, p);
      const hours = (t - last.at) / 3_600_000;
      implausible = hours > 0 && km / hours > cfg.maxPlausibleSpeedKmh && km > 0.2;
    }
    const outOfOrder = last !== null && t <= last.at;
    if (inFuture || badAccuracy || implausible || outOfOrder) {
      rejected++;
      continue;
    }
    accepted.push(p);
    last = { lat: p.lat, lng: p.lng, at: t };
  }

  // Fraud signal (spec §51): a batch dominated by implausible points flags the driver for
  // human review — flags never auto-suspend (CLAUDE.md / spec §38 principle).
  if (rejected >= 5 && rejected > accepted.length) {
    const flagged = await Driver.findOneAndUpdate(
      { _id: driverId, flags: trusted({ $ne: 'gps_anomalies' }) },
      { $addToSet: { flags: 'gps_anomalies' } },
      { returnDocument: 'after' },
    );
    if (flagged) {
      await audit({
        actor: { kind: 'system' },
        action: 'driver.flag',
        target: { kind: 'driver', id: driverId },
        after: { flag: 'gps_anomalies' },
        reason: `${rejected} implausible GPS points rejected in one batch`,
      });
    }
  }

  if (!accepted.length) return { accepted: 0, rejected };

  const newest = accepted[accepted.length - 1]!;
  await DriverLocation.updateOne(
    { driverId },
    {
      $set: {
        location: toGeoPoint(newest),
        accuracy: newest.accuracy,
        heading: newest.heading,
        speed: newest.speed,
        battery: newest.battery,
        source: newest.source,
        recordedAt: newest.recordedAt,
        receivedAt: new Date(),
      },
      $setOnInsert: { online: false },
    },
    { upsert: true },
  );

  // History sampling: persist at most one point per window.
  const lastSample = await LocationHistory.findOne({ driverId }).sort({ recordedAt: -1 }).select({ recordedAt: 1 });
  const windowMs = cfg.historySampleSeconds * 1000;
  const samples: LocationPoint[] = [];
  let cursor = lastSample?.recordedAt.getTime() ?? 0;
  for (const p of accepted) {
    if (p.recordedAt.getTime() - cursor >= windowMs) {
      samples.push(p);
      cursor = p.recordedAt.getTime();
    }
  }
  events.emit('location.updated', {
    driverId,
    lat: newest.lat,
    lng: newest.lng,
    heading: newest.heading,
    speed: newest.speed,
    recordedAt: newest.recordedAt,
    source: newest.source,
  });

  if (samples.length) {
    await LocationHistory.insertMany(
      samples.map((p) => ({
        driverId,
        location: toGeoPoint(p),
        accuracy: p.accuracy,
        speed: p.speed,
        source: p.source,
        recordedAt: p.recordedAt,
      })),
      { ordered: false },
    );
  }
  return { accepted: accepted.length, rejected };
}

/** Online/offline toggle. Going online requires a recent location soon after; discovery filters on freshness anyway. */
export async function setPresence(driverId: string, online: boolean) {
  await DriverLocation.updateOne(
    { driverId },
    {
      $set: { online, receivedAt: new Date() },
      $setOnInsert: { location: { type: 'Point', coordinates: [0, 0] }, recordedAt: new Date(0) },
    },
    { upsert: true },
  );
  events.emit('presence.changed', { driverId, online });
  return { online };
}

export type Presence = 'active' | 'background' | 'stale' | 'offline';

export function presenceOf(row: { online: boolean; receivedAt: Date; source?: string | null }, freshnessSeconds: number, now = Date.now()): Presence {
  if (!row.online) return 'offline';
  const age = (now - row.receivedAt.getTime()) / 1000;
  if (age > freshnessSeconds) return 'stale';
  return row.source === 'background' ? 'background' : 'active';
}

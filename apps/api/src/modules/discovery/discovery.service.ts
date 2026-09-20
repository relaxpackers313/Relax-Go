import { Types } from 'mongoose';
import type { DiscoveredDriver } from '@relaxgo/shared';
import { OPERATIONAL_DRIVER_STATUSES } from '@relaxgo/shared';
import { DriverLocation } from '../../models/location.model';
import { Driver } from '../../models/driver.model';
import { getSettings } from '../settings/settings.service';
import { trusted } from '../../lib/mongo';

export interface DiscoveryInput {
  lat: number;
  lng: number;
  radiusKm?: number;
  vehicleType?: string;
  limit?: number;
}

/**
 * The driver-discovery engine (spec §6–7): $geoNear over the live-location store, then
 * eligibility join on drivers. Everything variable — radius clamp, freshness, sort, max
 * results — comes from platform settings, never constants.
 */
export async function discoverDrivers(input: DiscoveryInput): Promise<{ drivers: DiscoveredDriver[]; radiusKm: number }> {
  const settings = await getSettings();
  const d = settings.discovery;

  const radiusKm = Math.min(Math.max(input.radiusKm ?? d.defaultRadiusKm, d.minRadiusKm), d.maxRadiusKm);
  const limit = Math.min(input.limit ?? d.maxDrivers, d.maxDrivers);
  const freshCutoff = new Date(Date.now() - d.locationFreshnessSeconds * 1000);

  // Stage 1: geo query on the live store — index-driven, never a full scan.
  const near = await DriverLocation.aggregate<{
    _id: Types.ObjectId;
    driverId: Types.ObjectId;
    distanceMeters: number;
    location: { coordinates: [number, number] };
    receivedAt: Date;
    source?: string;
    heading?: number | null;
  }>([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [input.lng, input.lat] },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        query: { online: true, receivedAt: { $gte: freshCutoff } },
        spherical: true,
      },
    },
    // Generous pre-limit before the eligibility join cuts ineligible drivers.
    { $limit: limit * 4 },
  ]);
  if (!near.length) return { drivers: [], radiusKm };

  // Stage 2: eligibility — status, vehicle type; blocked/suspended fall out via status.
  const driverQuery: Record<string, unknown> = {
    _id: trusted({ $in: near.map((n) => n.driverId) }),
    status: trusted({ $in: [...OPERATIONAL_DRIVER_STATUSES] }),
  };
  if (input.vehicleType) driverQuery.vehicleType = input.vehicleType;
  const drivers = await Driver.find(driverQuery).select(
    'fullName photoUrl vehicleType vehicleModel registrationNumber rating',
  );
  const byId = new Map(drivers.map((dr) => [String(dr._id), dr]));

  const now = Date.now();
  const results: DiscoveredDriver[] = [];
  for (const n of near) {
    const dr = byId.get(String(n.driverId));
    if (!dr) continue;
    results.push({
      driverId: String(dr._id),
      name: dr.fullName ?? 'Driver',
      photoUrl: dr.photoUrl ?? undefined,
      vehicleType: dr.vehicleType ?? 'unknown',
      vehicleModel: dr.vehicleModel ?? undefined,
      registrationNumber: dr.registrationNumber ?? undefined,
      rating: { average: dr.rating?.average ?? null, count: dr.rating?.count ?? 0 },
      distanceKm: Math.round((n.distanceMeters / 1000) * 100) / 100,
      location: { lat: n.location.coordinates[1], lng: n.location.coordinates[0] },
      lastSeenSecondsAgo: Math.max(0, Math.round((now - n.receivedAt.getTime()) / 1000)),
      heading: n.heading ?? null,
      presence: n.source === 'background' ? 'background' : 'active',
    });
    if (results.length >= limit) break;
  }

  // $geoNear returns nearest-first already; re-rank only for the other configured modes.
  if (d.sortMode === 'rating') {
    results.sort((a, b) => (b.rating.average ?? 0) - (a.rating.average ?? 0) || a.distanceKm - b.distanceKm);
  } else if (d.sortMode === 'distance_then_rating') {
    results.sort((a, b) => a.distanceKm - b.distanceKm || (b.rating.average ?? 0) - (a.rating.average ?? 0));
  }

  return { drivers: results, radiusKm };
}

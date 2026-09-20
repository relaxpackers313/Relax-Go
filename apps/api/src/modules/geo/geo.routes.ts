import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../middleware/auth';
import { getSettings } from '../settings/settings.service';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { TtlCache } from '../../lib/ttl-cache';
import { bumpUsage } from '../../lib/usage';
import { haversineKm } from '@relaxgo/shared';

// Paid-provider guards: every Google call costs money, so identical lookups are answered from
// memory. Keys are rounded coordinates — a reverse lookup 10 m away is the same street.
const searchCache = new TtlCache<GeoResult[]>(10 * 60_000);
const reverseCache = new TtlCache<string | null>(6 * 60 * 60_000, 4000);
const routeCache = new TtlCache<{ provider: string; distanceKm: number; durationMinutes: number; polyline: string | null }>(2 * 60_000);
/** The Geocoding API is not enabled on every key; after a REQUEST_DENIED, stop trying for a day. */
let geocodeDisabledUntil = 0;

/**
 * Geocoding + routing behind the provider abstraction (spec §15–16): clients never talk to a
 * map provider directly — the configured provider is called server-side, results are
 * normalised, and provider keys never reach the apps. Google endpoints fall back to the free
 * OSM stack (Nominatim / straight line) whenever the key is missing or a call fails, so the
 * apps always get an answer.
 */
export const geoRouter: Router = Router();
geoRouter.use(requireAuth('customer'));

interface GeoResult {
  label: string;
  lat: number;
  lng: number;
}

const searchSchema = z.object({
  q: z.string().min(2).max(120),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

async function nominatimSearch(q: string, lat: number | undefined, lng: number | undefined): Promise<GeoResult[]> {
  const settings = await getSettings();
  const queryOnce = async (term: string): Promise<GeoResult[]> => {
    const url = new URL(`${settings.maps.nominatimUrl.replace(/\/$/, '')}/search`);
    url.searchParams.set('q', term);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('countrycodes', settings.brand.country.toLowerCase());
    if (lat !== undefined && lng !== undefined) {
      // Bias results to a ~50 km box around the searcher.
      url.searchParams.set('viewbox', `${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}`);
    }
    return fetch(url, { headers: { 'user-agent': `RelaxGo/1.0 (${settings.brand.supportEmail})` } })
      .then(async (r) => (r.ok ? ((await r.json()) as { display_name: string; lat: string; lon: string }[]) : []))
      .then((rows) => rows.map((row) => ({ label: row.display_name, lat: Number(row.lat), lng: Number(row.lon) })))
      .catch((err) => {
        logger.warn({ err }, 'geocoding failed');
        return [];
      });
  };
  // Nominatim matches literally; when the full phrase finds nothing, retry with fewer
  // trailing words ("KIIT Square Bhubaneswar" → "KIIT Square" → "KIIT").
  const words = q.split(/\s+/).filter(Boolean);
  let results: GeoResult[] = [];
  for (let n = words.length; n >= 1 && results.length === 0; n--) {
    results = await queryOnce(words.slice(0, n).join(' '));
  }
  return results;
}

async function googleSearch(q: string, lat: number | undefined, lng: number | undefined): Promise<GeoResult[] | null> {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  try {
    // Places API (legacy) Text Search — the service enabled on this key.
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', q);
    url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
    url.searchParams.set('region', 'in');
    if (lat !== undefined && lng !== undefined) {
      url.searchParams.set('location', `${lat},${lng}`);
      url.searchParams.set('radius', '50000');
    }
    const r = await fetch(url);
    if (!r.ok) {
      logger.warn({ status: r.status }, 'google places search failed');
      return null;
    }
    const data = (await r.json()) as {
      status: string;
      results?: { name?: string; formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }[];
    };
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      logger.warn({ status: data.status }, 'google places search non-OK');
      return null;
    }
    return (data.results ?? [])
      .slice(0, 6)
      .filter((p) => p.geometry?.location)
      .map((p) => ({
        label: [p.name, p.formatted_address?.replace(/,\s*India$/i, '')].filter(Boolean).join(', '),
        lat: p.geometry!.location!.lat,
        lng: p.geometry!.location!.lng,
      }));
  } catch (err) {
    logger.warn({ err }, 'google places search errored');
    return null;
  }
}

geoRouter.get(
  '/search',
  asyncRoute(async (req, res) => {
    const { q, lat, lng } = parse(searchSchema, req.query);
    // Bias rounded to ~1 km: the same query from nearby users shares one provider call.
    const key = `${q.trim().toLowerCase()}|${lat?.toFixed(2) ?? ''}|${lng?.toFixed(2) ?? ''}`;
    const cached = searchCache.get(key);
    if (cached) {
      bumpUsage('maps.cache.search');
      res.json({ results: cached });
      return;
    }
    const settings = await getSettings();
    let results: GeoResult[] | null = null;
    if (settings.maps.geocodingProvider === 'google') {
      results = await googleSearch(q, lat, lng);
      if (results !== null) bumpUsage('maps.google.places_search');
    }
    if (results === null || results.length === 0) {
      results = await nominatimSearch(q, lat, lng);
      bumpUsage('maps.free.nominatim_search');
    }
    searchCache.set(key, results);
    res.json({ results });
  }),
);

const reverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

async function nominatimReverse(lat: number, lng: number): Promise<string | null> {
  const settings = await getSettings();
  const url = new URL(`${settings.maps.nominatimUrl.replace(/\/$/, '')}/reverse`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('zoom', '17');
  return fetch(url, { headers: { 'user-agent': `RelaxGo/1.0 (${settings.brand.supportEmail})` } })
    .then(async (r) => (r.ok ? ((await r.json()) as { display_name?: string; name?: string; address?: Record<string, string> }) : null))
    .then((d) => {
      if (!d) return null;
      const a = d.address ?? {};
      const parts = [d.name || a.amenity || a.building || a.road, a.suburb || a.neighbourhood || a.city_district, a.city || a.town || a.village].filter(Boolean);
      return parts.length ? parts.join(', ') : (d.display_name ?? null);
    })
    .catch((err) => {
      logger.warn({ err }, 'reverse geocoding failed');
      return null;
    });
}

async function googleReverse(lat: number, lng: number): Promise<string | null> {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  // Geocoding API first (exact street addresses); Places nearby as the POI-name fallback.
  if (Date.now() > geocodeDisabledUntil) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${lat},${lng}`);
      url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
      url.searchParams.set('result_type', 'street_address|premise|point_of_interest|sublocality|route');
      const r = await fetch(url);
      bumpUsage('maps.google.geocode');
      if (r.ok) {
        const data = (await r.json()) as { status: string; results?: { formatted_address: string }[] };
        if (data.status === 'OK' && data.results?.length) {
          // Trim the trailing ", India" and postal code noise for the pickup pill.
          return data.results[0]!.formatted_address.replace(/,\s*India$/i, '').replace(/,\s*\d{6}(?=,|$)/, '');
        }
        if (data.status === 'REQUEST_DENIED') {
          // Not enabled on this key — stop burning a wasted call per lookup for a day.
          geocodeDisabledUntil = Date.now() + 24 * 60 * 60_000;
        }
        logger.warn({ status: data.status }, 'google reverse geocode non-OK');
      }
    } catch (err) {
      logger.warn({ err }, 'google reverse geocode errored');
    }
  }
  try {
    // Places API (legacy) Nearby Search: the closest named place makes a good pickup label.
    const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', '200');
    url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
    const r = await fetch(url);
    bumpUsage('maps.google.places_nearby');
    if (r.ok) {
      const data = (await r.json()) as { status: string; results?: { name?: string; vicinity?: string; types?: string[] }[] };
      if (data.status === 'OK') {
        // Skip the bare political/locality rows in favour of an actual place.
        const p =
          data.results?.find((x) => x.name && !(x.types ?? []).some((t) => ['political', 'locality', 'sublocality'].includes(t))) ??
          data.results?.[0];
        if (p) return [p.name, p.vicinity].filter(Boolean).join(', ') || null;
      } else {
        logger.warn({ status: data.status }, 'google places nearby non-OK');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'google places nearby errored');
  }
  return null;
}

/** Reverse geocoding for the pickup pill: coordinates → a short human place name. */
geoRouter.get(
  '/reverse',
  asyncRoute(async (req, res) => {
    const { lat, lng } = parse(reverseSchema, req.query);
    // ~11 m grid: dragging the pin within a building resolves from cache, not from Google.
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = reverseCache.get(key);
    if (cached !== undefined) {
      bumpUsage('maps.cache.reverse');
      res.json({ label: cached });
      return;
    }
    const settings = await getSettings();
    let label: string | null = null;
    if (settings.maps.geocodingProvider === 'google') label = await googleReverse(lat, lng);
    if (label === null) {
      label = await nominatimReverse(lat, lng);
      bumpUsage('maps.free.nominatim_reverse');
    }
    reverseCache.set(key, label);
    res.json({ label });
  }),
);

const routeSchema = z.object({
  fromLat: z.coerce.number().min(-90).max(90),
  fromLng: z.coerce.number().min(-180).max(180),
  toLat: z.coerce.number().min(-90).max(90),
  toLng: z.coerce.number().min(-180).max(180),
  vehicleType: z.string().max(30).optional(),
});

/**
 * Road route between two points (driver → pickup) for the on-map distance interface:
 * encoded polyline + road distance + ETA from the Routes API, falling back to the
 * straight line when routing is unavailable so the map always shows something.
 */
geoRouter.get(
  '/route',
  asyncRoute(async (req, res) => {
    const { fromLat, fromLng, toLat, toLng, vehicleType } = parse(routeSchema, req.query);
    // ~110 m grid + 2 min TTL: the checkout screen's periodic refresh reuses the same route.
    const cacheKey = `${fromLat.toFixed(3)},${fromLng.toFixed(3)}|${toLat.toFixed(3)},${toLng.toFixed(3)}|${vehicleType ?? ''}`;
    const cachedRoute = routeCache.get(cacheKey);
    if (cachedRoute) {
      bumpUsage('maps.cache.route');
      res.json(cachedRoute);
      return;
    }
    const settings = await getSettings();
    const straight = () => {
      const km = Math.round(haversineKm({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }) * 100) / 100;
      res.json({
        provider: 'straight_line',
        distanceKm: km,
        durationMinutes: Math.max(1, Math.round((km / 22) * 60)),
        polyline: null,
      });
    };
    if (settings.maps.routingProvider !== 'google' || !env.GOOGLE_MAPS_API_KEY) return straight();
    try {
      const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
          destination: { location: { latLng: { latitude: toLat, longitude: toLng } } },
          travelMode: vehicleType === 'bike' ? 'TWO_WHEELER' : 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
      });
      if (!r.ok) {
        logger.warn({ status: r.status, body: (await r.text()).slice(0, 300) }, 'google routes failed');
        return straight();
      }
      bumpUsage('maps.google.routes');
      const data = (await r.json()) as { routes?: { distanceMeters: number; duration: string; polyline?: { encodedPolyline?: string } }[] };
      const route = data.routes?.[0];
      if (!route) return straight();
      const seconds = Number(route.duration?.replace(/s$/, '') ?? 0);
      const payload = {
        provider: 'google',
        distanceKm: Math.round((route.distanceMeters / 1000) * 100) / 100,
        durationMinutes: Math.max(1, Math.round(seconds / 60)),
        polyline: route.polyline?.encodedPolyline ?? null,
      };
      routeCache.set(cacheKey, payload);
      res.json(payload);
    } catch (err) {
      logger.warn({ err }, 'google routes errored');
      straight();
    }
  }),
);

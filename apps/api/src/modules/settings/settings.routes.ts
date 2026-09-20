import { Router } from 'express';
import { asyncRoute } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { getSettings, getSettingsWithVersion, updateSettings } from './settings.service';

export const settingsRouter: Router = Router();

settingsRouter.use(requireAuth('admin'));

settingsRouter.get(
  '/',
  requirePermission('settings.view'),
  asyncRoute(async (_req, res) => {
    res.json(await getSettingsWithVersion());
  }),
);

settingsRouter.patch(
  '/',
  requirePermission('settings.edit'),
  asyncRoute(async (req, res) => {
    const { patch, reason } = (req.body ?? {}) as { patch?: unknown; reason?: string };
    const admin = req.ctx!.admin!;
    const result = await updateSettings(patch ?? req.body, { kind: 'admin', id: req.ctx!.id, name: admin.name }, reason);
    res.json(result);
  }),
);

/** Public, read-only slice for clients: brand, vehicle types, feature flags, map tiles. */
export const publicConfigRouter: Router = Router();
publicConfigRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    const s = await getSettings();
    res.json({
      auth: { driverAuthMode: s.auth.driverAuthMode },
      brand: s.brand,
      vehicleTypes: s.vehicleTypes.filter((v) => v.active),
      features: s.features,
      maps: { provider: s.maps.provider, tileUrl: s.maps.tileUrl, tileAttribution: s.maps.tileAttribution },
      safety: { sosEnabled: s.safety.sosEnabled, sosNumbers: s.safety.sosNumbers, tripSharingEnabled: s.safety.tripSharingEnabled },
      discovery: { defaultRadiusKm: s.discovery.defaultRadiusKm, maxRadiusKm: s.discovery.maxRadiusKm },
      location: { foregroundIntervalSeconds: s.location.foregroundIntervalSeconds, backgroundIntervalSeconds: s.location.backgroundIntervalSeconds },
    });
  }),
);

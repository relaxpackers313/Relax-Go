import { Router } from 'express';
import { locationBatchSchema, presenceSchema } from '@relaxgo/shared';
import { asyncRoute } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth, requireApprovedDriver } from '../../middleware/auth';
import { locationRateLimit } from '../../middleware/rate-limit';
import { ingestLocations, setPresence } from './locations.service';

export const driverLocationRouter: Router = Router();
driverLocationRouter.use(requireAuth('driver'), requireApprovedDriver);

driverLocationRouter.post(
  '/locations',
  locationRateLimit,
  asyncRoute(async (req, res) => {
    const { points } = parse(locationBatchSchema, req.body);
    res.json(await ingestLocations(req.ctx!.id, points));
  }),
);

driverLocationRouter.post(
  '/presence',
  asyncRoute(async (req, res) => {
    const { online } = parse(presenceSchema, req.body);
    res.json(await setPresence(req.ctx!.id, online));
  }),
);

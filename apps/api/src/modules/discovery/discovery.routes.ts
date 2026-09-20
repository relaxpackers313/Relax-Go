import { Router } from 'express';
import { discoveryQuerySchema } from '@relaxgo/shared';
import { asyncRoute } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../middleware/auth';
import { CustomerSession } from '../../models/customer.model';
import { discoverDrivers } from './discovery.service';

export const discoveryRouter: Router = Router();
discoveryRouter.use(requireAuth('customer'));

discoveryRouter.get(
  '/nearby',
  asyncRoute(async (req, res) => {
    const q = parse(discoveryQuerySchema, req.query);
    const { bumpUsage } = await import('../../lib/usage');
    bumpUsage('discovery.search');
    // Live-demand signal for the driver zone map: analytics, never blocks the request.
    CustomerSession.updateOne(
      { _id: req.ctx!.id },
      { $set: { lastSearch: { location: { type: 'Point', coordinates: [q.lng, q.lat] }, vehicleType: q.vehicleType, at: new Date() } } },
    )
      .exec()
      .catch(() => undefined);
    res.json(await discoverDrivers(q));
  }),
);

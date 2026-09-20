import { Router } from 'express';
import { z } from 'zod';
import { callInitiateSchema, callOutcomeSchema, placeSchema } from '@relaxgo/shared';
import { asyncRoute } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth, requireApprovedDriver } from '../../middleware/auth';
import { callRateLimit } from '../../middleware/rate-limit';
import { initiateCall, initiateCustomerCall, listDriverCalls, reportOutcome } from './calls.service';

export const driverCallsRouter: Router = Router();
driverCallsRouter.use(requireAuth('driver'), requireApprovedDriver);

driverCallsRouter.post(
  '/',
  callRateLimit,
  asyncRoute(async (req, res) => {
    const { leadId } = parse(callInitiateSchema, req.body);
    res.status(201).json(await initiateCall(req.ctx!.driver!, leadId));
  }),
);

driverCallsRouter.post(
  '/:id/outcome',
  asyncRoute(async (req, res) => {
    const { status, durationSeconds } = parse(callOutcomeSchema, req.body);
    res.json(await reportOutcome(req.ctx!.id, req.params.id as string, status, durationSeconds));
  }),
);

driverCallsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ items: await listDriverCalls(req.ctx!.id) });
  }),
);

/** Customer click-to-call: tap a driver → dial. The lead + billing happen server-side. */
export const customerCallsRouter: Router = Router();
customerCallsRouter.use(requireAuth('customer'));

const customerCallSchema = z.object({
  driverId: z.string().length(24),
  pickup: placeSchema,
  vehicleType: z.string().max(30).optional(),
});

customerCallsRouter.post(
  '/',
  callRateLimit,
  asyncRoute(async (req, res) => {
    const input = parse(customerCallSchema, req.body);
    res.status(201).json(await initiateCustomerCall(req.ctx!.id, input));
  }),
);

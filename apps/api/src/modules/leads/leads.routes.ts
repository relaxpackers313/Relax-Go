import { Router } from 'express';
import { leadCreateSchema, leadDriverActionSchema } from '@relaxgo/shared';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth, requireApprovedDriver } from '../../middleware/auth';
import { leadRateLimit } from '../../middleware/rate-limit';
import { Lead } from '../../models/lead.model';
import { createLead, listDriverLeads, transitionLead } from './leads.service';

export const customerLeadsRouter: Router = Router();
customerLeadsRouter.use(requireAuth('customer'));

customerLeadsRouter.post(
  '/',
  leadRateLimit,
  asyncRoute(async (req, res) => {
    const input = parse(leadCreateSchema, req.body);
    const lead = await createLead(req.ctx!.id, input);
    res.status(201).json(lead);
  }),
);

customerLeadsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const leads = await Lead.find({ customerSessionId: req.ctx!.id }).sort({ createdAt: -1 }).limit(50);
    res.json({ items: leads });
  }),
);

customerLeadsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const lead = await Lead.findOne({ _id: req.params.id, customerSessionId: req.ctx!.id });
    if (!lead) throw ApiError.notFound('Request not found');
    // The customer picked this driver, so the tracking screen may show the public driver card.
    const { Driver } = await import('../../models/driver.model');
    const d = await Driver.findById(lead.driverId).select('fullName photoUrl vehicleType vehicleModel registrationNumber rating');
    res.json({
      ...lead.toObject(),
      driver: d
        ? {
            name: d.fullName ?? 'Driver',
            photoUrl: d.photoUrl ?? null,
            vehicleType: d.vehicleType ?? null,
            vehicleModel: d.vehicleModel ?? null,
            registrationNumber: d.registrationNumber ?? null,
            rating: { average: d.rating?.average ?? null, count: d.rating?.count ?? 0 },
          }
        : null,
    });
  }),
);

customerLeadsRouter.post(
  '/:id/cancel',
  asyncRoute(async (req, res) => {
    const lead = await Lead.findOne({ _id: req.params.id, customerSessionId: req.ctx!.id });
    if (!lead) throw ApiError.notFound('Request not found');
    await transitionLead(lead, 'cancelled', { kind: 'customer', id: req.ctx!.id });
    res.json(lead);
  }),
);

export const driverLeadsRouter: Router = Router();
driverLeadsRouter.use(requireAuth('driver'), requireApprovedDriver);

driverLeadsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json({ items: await listDriverLeads(req.ctx!.id, status) });
  }),
);

driverLeadsRouter.post(
  '/:id/action',
  asyncRoute(async (req, res) => {
    const { action, reason } = parse(leadDriverActionSchema, req.body);
    const lead = await Lead.findOne({ _id: req.params.id, driverId: req.ctx!.id }).select('-contactPhone');
    if (!lead) throw ApiError.notFound('Lead not found');
    const to = action === 'viewed' ? 'viewed' : action === 'accept' ? 'accepted' : 'rejected';
    await transitionLead(lead, to, { kind: 'driver', id: req.ctx!.id }, reason);
    res.json(lead);
  }),
);

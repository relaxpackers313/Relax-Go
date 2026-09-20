import { Router } from 'express';
import { z } from 'zod';
import { supportCreateSchema, supportReplySchema } from '@relaxgo/shared';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAnyAuth, requireAuth, requirePermission } from '../../middleware/auth';
import { SupportTicket } from '../../models/ops.model';
import { Notification } from '../../models/ops.model';
import { trusted } from '../../lib/mongo';

/** Shared by drivers and customers (spec §55). */
export const supportRouter: Router = Router();
supportRouter.use(requireAnyAuth(['driver', 'customer']));

supportRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const input = parse(supportCreateSchema, req.body);
    const kind = req.ctx!.kind as 'driver' | 'customer';
    const ticket = await SupportTicket.create({
      raisedBy: { kind, id: req.ctx!.id },
      category: input.category,
      subject: input.subject,
      messages: [{ from: { kind, id: req.ctx!.id }, body: input.body, at: new Date() }],
    });
    res.status(201).json(ticket);
  }),
);

supportRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const kind = req.ctx!.kind as 'driver' | 'customer';
    const items = await SupportTicket.find({ 'raisedBy.kind': kind, 'raisedBy.id': req.ctx!.id }).sort({ updatedAt: -1 }).limit(50);
    res.json({ items });
  }),
);

supportRouter.post(
  '/:id/reply',
  asyncRoute(async (req, res) => {
    const { body } = parse(supportReplySchema, req.body);
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket || ticket.raisedBy?.kind !== req.ctx!.kind || ticket.raisedBy?.id !== req.ctx!.id) throw ApiError.notFound('Ticket not found');
    if (ticket.status === 'closed') throw ApiError.conflict('This ticket is closed');
    ticket.messages.push({ from: { kind: req.ctx!.kind as 'driver' | 'customer', id: req.ctx!.id }, body, at: new Date() } as never);
    if (ticket.status === 'resolved') ticket.status = 'open';
    await ticket.save();
    res.json(ticket);
  }),
);

/** Admin side: queue, assignment, replies, resolution. */
export const adminSupportRouter: Router = Router();
adminSupportRouter.use(requireAuth('admin'), requirePermission('support.manage'));

adminSupportRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const q = parse(z.object({ status: z.string().optional(), category: z.string().optional() }), req.query);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.category) filter.category = q.category;
    res.json({ items: await SupportTicket.find(filter).sort({ updatedAt: -1 }).limit(200) });
  }),
);

adminSupportRouter.post(
  '/:id',
  asyncRoute(async (req, res) => {
    const input = parse(
      z.object({
        reply: z.string().max(4000).optional(),
        status: z.enum(['open', 'assigned', 'resolved', 'escalated', 'closed']).optional(),
        assign: z.boolean().optional(),
      }),
      req.body,
    );
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) throw ApiError.notFound('Ticket not found');
    if (input.reply && ticket.raisedBy) {
      ticket.messages.push({ from: { kind: 'admin', id: req.ctx!.id }, body: input.reply, at: new Date() } as never);
      await Notification.create({
        audience: { kind: ticket.raisedBy.kind, id: ticket.raisedBy.id },
        channel: 'in_app',
        type: 'support.reply',
        title: 'Support replied',
        body: input.reply.slice(0, 140),
        data: { ticketId: String(ticket._id) },
      });
    }
    if (input.assign) {
      ticket.assigneeId = req.ctx!.admin ? (req.ctx!.id as never) : ticket.assigneeId;
      if (ticket.status === 'open') ticket.status = 'assigned';
    }
    if (input.status) ticket.status = input.status;
    await ticket.save();
    res.json(ticket);
  }),
);

/** In-app notification feed for drivers and customers. */
export const notificationsRouter: Router = Router();
notificationsRouter.use(requireAnyAuth(['driver', 'customer']));

notificationsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const items = await Notification.find({ 'audience.kind': req.ctx!.kind, 'audience.id': req.ctx!.id }).sort({ createdAt: -1 }).limit(50);
    res.json({ items, unread: items.filter((n) => !n.readAt).length });
  }),
);

/** Device push-token registration for both drivers and customers (spec §34–35). */
notificationsRouter.post(
  '/push-token',
  asyncRoute(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    if (req.ctx!.kind === 'driver') {
      const { Driver } = await import('../../models/driver.model');
      await Driver.updateOne({ _id: req.ctx!.id }, { $set: { pushToken: token } });
    } else {
      const { CustomerSession } = await import('../../models/customer.model');
      await CustomerSession.updateOne({ _id: req.ctx!.id }, { $set: { pushToken: token } });
    }
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/read',
  asyncRoute(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string().length(24)).max(100).optional() }), req.body ?? {});
    const filter: Record<string, unknown> = { 'audience.kind': req.ctx!.kind, 'audience.id': req.ctx!.id, readAt: null };
    if (ids?.length) filter._id = trusted({ $in: ids });
    await Notification.updateMany(filter, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);

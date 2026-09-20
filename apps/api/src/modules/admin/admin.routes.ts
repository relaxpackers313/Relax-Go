import { Router } from 'express';
import { z } from 'zod';
import { pricingRuleInputSchema, walletAdjustSchema, ADMIN_ROLES, PERMISSIONS } from '@relaxgo/shared';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { trusted } from '../../lib/mongo';
import { audit } from '../../lib/audit';
import { hashPassword } from '../../lib/passwords';
import { Driver } from '../../models/driver.model';
import { CustomerSession } from '../../models/customer.model';
import { DriverLocation } from '../../models/location.model';
import { Call, Lead, Trip } from '../../models/lead.model';
import { Payment, PricingRule, Wallet, WalletTransaction } from '../../models/wallet.model';
import { AuditLog, ServiceArea, SupportTicket } from '../../models/ops.model';
import { AdminUser } from '../../models/admin.model';
import { getSettings } from '../settings/settings.service';
import { presenceOf } from '../locations/locations.service';
import { adminAdjust, listTransactions } from '../wallet/wallet.service';
import { fromGeoPoint } from '../../models/geo';

export const adminOpsRouter: Router = Router();
adminOpsRouter.use(requireAuth('admin'));

const actor = (req: { ctx?: { id: string; admin?: { name: string } } }) => ({ kind: 'admin' as const, id: req.ctx!.id, name: req.ctx!.admin?.name });

// ---------- Usage & traffic (maps spend, cache savings, server load) ----------
adminOpsRouter.get(
  '/usage',
  requirePermission('reports.view'),
  asyncRoute(async (_req, res) => {
    const { UsageStat, flushUsage } = await import('../../lib/usage');
    await flushUsage(); // dashboard reads should be current, not 30s behind
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      days.push(new Date(Date.now() - i * 24 * 60 * 60_000).toISOString().slice(0, 10));
    }
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [rows, activeCustomersToday] = await Promise.all([
      UsageStat.find({ day: trusted({ $in: days }) }).lean(),
      CustomerSession.countDocuments({ lastSeenAt: trusted({ $gte: dayStart }) }),
    ]);
    res.json({
      days,
      rows: rows.map((r) => ({ day: r.day, kind: r.kind, count: r.count })),
      activeCustomersToday,
      note: 'Mobile map views (Maps SDK for Android) are free and unlimited — billable usage is only the server-side Places/Routes calls counted here.',
    });
  }),
);

// ---------- Dashboard ----------
adminOpsRouter.get(
  '/dashboard',
  requirePermission('reports.view'),
  asyncRoute(async (_req, res) => {
    const settings = await getSettings();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const fresh = new Date(Date.now() - settings.discovery.locationFreshnessSeconds * 1000);
    const [driversByStatus, onlineDrivers, customers, leadsToday, leadsTotal, callsToday, chargedToday, rechargeTotal, walletAgg, openTickets, activeTrips] =
      await Promise.all([
        Driver.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        DriverLocation.countDocuments({ online: true, receivedAt: trusted({ $gte: fresh }) }),
        CustomerSession.estimatedDocumentCount(),
        Lead.countDocuments({ createdAt: trusted({ $gte: dayStart }) }),
        Lead.estimatedDocumentCount(),
        Call.countDocuments({ initiatedAt: trusted({ $gte: dayStart }) }),
        WalletTransaction.aggregate<{ _id: null; paise: number }>([
          { $match: { kind: 'call_charge', createdAt: { $gte: dayStart } } },
          { $group: { _id: null, paise: { $sum: { $abs: '$amountPaise' } } } },
        ]),
        Payment.aggregate<{ _id: null; paise: number }>([
          { $match: { status: 'verified' } },
          { $group: { _id: null, paise: { $sum: '$amountPaise' } } },
        ]),
        Wallet.aggregate<{ _id: null; paise: number }>([{ $group: { _id: null, paise: { $sum: '$balancePaise' } } }]),
        SupportTicket.countDocuments({ status: trusted({ $in: ['open', 'assigned', 'escalated'] }) }),
        Trip.countDocuments({ status: trusted({ $in: ['driver_confirmed', 'driver_en_route', 'arrived', 'started'] }) }),
      ]);
    res.json({
      drivers: Object.fromEntries(driversByStatus.map((d) => [d._id, d.n])),
      onlineDrivers,
      customers,
      leads: { today: leadsToday, total: leadsTotal },
      callsToday,
      revenue: { callChargesTodayPaise: chargedToday[0]?.paise ?? 0, rechargesTotalPaise: rechargeTotal[0]?.paise ?? 0 },
      walletFloatPaise: walletAgg[0]?.paise ?? 0,
      openTickets,
      activeTrips,
    });
  }),
);

// ---------- Live operations map (spec §31; gated by the location-privacy permission §66) ----------
adminOpsRouter.get(
  '/map/live',
  requirePermission('locations.live.view'),
  asyncRoute(async (_req, res) => {
    const settings = await getSettings();
    const rows = await DriverLocation.find({ online: true }).limit(2000);
    const drivers = await Driver.find({ _id: trusted({ $in: rows.map((r) => r.driverId) }) }).select('fullName status vehicleType registrationNumber flags');
    const byId = new Map(drivers.map((d) => [String(d._id), d]));
    res.json({
      drivers: rows.flatMap((row) => {
        const d = byId.get(String(row.driverId));
        if (!d) return [];
        return [
          {
            driverId: String(row.driverId),
            name: d.fullName,
            status: d.status,
            vehicleType: d.vehicleType,
            registrationNumber: d.registrationNumber,
            flags: d.flags,
            location: fromGeoPoint(row.location as never),
            presence: presenceOf(row as never, settings.discovery.locationFreshnessSeconds),
            lastUpdate: row.receivedAt,
            battery: row.battery ?? null,
          },
        ];
      }),
    });
  }),
);

// ---------- Customers (spec §30) ----------
adminOpsRouter.get(
  '/customers',
  requirePermission('customers.view'),
  asyncRoute(async (req, res) => {
    const q = parse(z.object({ blocked: z.coerce.boolean().optional(), page: z.coerce.number().int().positive().default(1) }), req.query);
    const filter: Record<string, unknown> = {};
    if (q.blocked !== undefined) filter.blocked = q.blocked;
    const limit = 50;
    const [items, total] = await Promise.all([
      CustomerSession.find(filter).sort({ lastSeenAt: -1 }).skip((q.page - 1) * limit).limit(limit),
      CustomerSession.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, limit });
  }),
);

adminOpsRouter.post(
  '/customers/:id/block',
  requirePermission('customers.block'),
  asyncRoute(async (req, res) => {
    const { blocked, reason } = parse(z.object({ blocked: z.boolean(), reason: z.string().max(500).optional() }), req.body);
    if (blocked && !reason) throw ApiError.unprocessable('A reason is required to block', { reason: 'Required' });
    const session = await CustomerSession.findById(req.params.id);
    if (!session) throw ApiError.notFound('Customer session not found');
    const before = session.blocked;
    session.blocked = blocked;
    session.blockedReason = blocked ? reason : undefined;
    await session.save();
    await audit({ actor: actor(req), action: blocked ? 'customer.block' : 'customer.unblock', target: { kind: 'customer_session', id: String(session._id) }, before: { blocked: before }, after: { blocked }, reason });
    res.json({ blocked });
  }),
);

// ---------- Leads & calls ----------
adminOpsRouter.get(
  '/leads',
  requirePermission('leads.view'),
  asyncRoute(async (req, res) => {
    const q = parse(z.object({ status: z.string().optional(), driverId: z.string().length(24).optional(), page: z.coerce.number().int().positive().default(1) }), req.query);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.driverId) filter.driverId = q.driverId;
    const limit = 50;
    const [items, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * limit).limit(limit),
      Lead.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, limit });
  }),
);

adminOpsRouter.get(
  '/calls',
  requirePermission('calls.view'),
  asyncRoute(async (req, res) => {
    const q = parse(z.object({ driverId: z.string().length(24).optional(), classification: z.string().optional(), page: z.coerce.number().int().positive().default(1) }), req.query);
    const filter: Record<string, unknown> = {};
    if (q.driverId) filter.driverId = q.driverId;
    if (q.classification) filter['billing.classification'] = q.classification;
    const limit = 50;
    const [items, total] = await Promise.all([
      Call.find(filter).sort({ initiatedAt: -1 }).skip((q.page - 1) * limit).limit(limit),
      Call.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, limit });
  }),
);

// ---------- Wallets ----------
adminOpsRouter.get(
  '/wallets/:driverId',
  requirePermission('wallets.view'),
  asyncRoute(async (req, res) => {
    const wallet = await Wallet.findOne({ driverId: req.params.driverId });
    if (!wallet) throw ApiError.notFound('Wallet not found');
    res.json({ wallet, transactions: await listTransactions(req.params.driverId as string, 100) });
  }),
);

adminOpsRouter.post(
  '/wallets/:driverId/adjust',
  requirePermission('wallets.adjust'),
  asyncRoute(async (req, res) => {
    const input = parse(walletAdjustSchema, req.body);
    const wallet = await adminAdjust(actor(req), req.params.driverId as string, input);
    res.json({ balancePaise: wallet.balancePaise, freeCredits: wallet.freeCredits, promoCredits: wallet.promoCredits });
  }),
);

// ---------- Pricing rules (spec §26–27) ----------
adminOpsRouter.get(
  '/pricing-rules',
  requirePermission('pricing.manage'),
  asyncRoute(async (_req, res) => {
    res.json({ items: await PricingRule.find().sort({ priority: -1, createdAt: -1 }) });
  }),
);

adminOpsRouter.post(
  '/pricing-rules',
  requirePermission('pricing.manage'),
  asyncRoute(async (req, res) => {
    const input = parse(pricingRuleInputSchema, req.body);
    const rule = await PricingRule.create({ ...input, createdBy: req.ctx!.id });
    await audit({ actor: actor(req), action: 'pricing.rule.create', target: { kind: 'pricing_rule', id: String(rule._id) }, after: input });
    res.status(201).json(rule);
  }),
);

adminOpsRouter.put(
  '/pricing-rules/:id',
  requirePermission('pricing.manage'),
  asyncRoute(async (req, res) => {
    const input = parse(pricingRuleInputSchema, req.body);
    const rule = await PricingRule.findById(req.params.id);
    if (!rule) throw ApiError.notFound('Rule not found');
    const before = { name: rule.name, active: rule.active, priority: rule.priority, pricePaise: rule.pricePaise, match: rule.match };
    rule.set(input);
    await rule.save();
    await audit({ actor: actor(req), action: 'pricing.rule.update', target: { kind: 'pricing_rule', id: String(rule._id) }, before, after: input });
    res.json(rule);
  }),
);

adminOpsRouter.delete(
  '/pricing-rules/:id',
  requirePermission('pricing.manage'),
  asyncRoute(async (req, res) => {
    const rule = await PricingRule.findByIdAndDelete(req.params.id);
    if (!rule) throw ApiError.notFound('Rule not found');
    await audit({ actor: actor(req), action: 'pricing.rule.delete', target: { kind: 'pricing_rule', id: String(rule._id) }, before: { name: rule.name, pricePaise: rule.pricePaise } });
    res.json({ deleted: true });
  }),
);

// ---------- Service areas (spec §32) ----------
const serviceAreaInput = z.object({
  name: z.string().min(2).max(120),
  city: z.string().min(2).max(80),
  kind: z.enum(['polygon', 'circle']),
  polygon: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }).optional(),
  center: z.object({ lat: z.number(), lng: z.number() }).optional(),
  radiusKm: z.number().positive().optional(),
  active: z.boolean().default(true),
});

adminOpsRouter.get(
  '/service-areas',
  requirePermission('serviceareas.manage'),
  asyncRoute(async (_req, res) => {
    res.json({ items: await ServiceArea.find().sort({ city: 1, name: 1 }) });
  }),
);

adminOpsRouter.post(
  '/service-areas',
  requirePermission('serviceareas.manage'),
  asyncRoute(async (req, res) => {
    const input = parse(serviceAreaInput, req.body);
    if (input.kind === 'polygon' && !input.polygon) throw ApiError.unprocessable('Polygon geometry required', { polygon: 'Required' });
    if (input.kind === 'circle' && (!input.center || !input.radiusKm)) throw ApiError.unprocessable('Center and radius required', { center: 'Required' });
    const area = await ServiceArea.create(input);
    await audit({ actor: actor(req), action: 'servicearea.create', target: { kind: 'service_area', id: String(area._id) }, after: { name: input.name, city: input.city } });
    res.status(201).json(area);
  }),
);

adminOpsRouter.put(
  '/service-areas/:id',
  requirePermission('serviceareas.manage'),
  asyncRoute(async (req, res) => {
    const input = parse(serviceAreaInput.partial(), req.body);
    const area = await ServiceArea.findById(req.params.id);
    if (!area) throw ApiError.notFound('Service area not found');
    area.set(input);
    await area.save();
    await audit({ actor: actor(req), action: 'servicearea.update', target: { kind: 'service_area', id: String(area._id) }, after: input });
    res.json(area);
  }),
);

// ---------- Audit log ----------
adminOpsRouter.get(
  '/audit',
  requirePermission('audit.view'),
  asyncRoute(async (req, res) => {
    const q = parse(z.object({ action: z.string().optional(), targetId: z.string().optional(), page: z.coerce.number().int().positive().default(1) }), req.query);
    const filter: Record<string, unknown> = {};
    if (q.action) filter.action = q.action;
    if (q.targetId) filter['target.id'] = q.targetId;
    const limit = 100;
    res.json({ items: await AuditLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * limit).limit(limit) });
  }),
);

// ---------- Admin users (spec: admins.manage) ----------
adminOpsRouter.get(
  '/admins',
  requirePermission('admins.manage'),
  asyncRoute(async (_req, res) => {
    res.json({ items: await AdminUser.find().select('-passwordHash').sort({ createdAt: 1 }) });
  }),
);

adminOpsRouter.post(
  '/admins',
  requirePermission('admins.manage'),
  asyncRoute(async (req, res) => {
    const input = parse(
      z.object({
        email: z.email().max(120),
        password: z.string().min(10).max(200),
        name: z.string().min(2).max(120),
        role: z.enum(ADMIN_ROLES),
        permissions: z.array(z.enum(PERMISSIONS)).default([]),
      }),
      req.body,
    );
    if (await AdminUser.findOne({ email: input.email.toLowerCase() })) throw ApiError.conflict('An admin with this email exists');
    const admin = await AdminUser.create({ ...input, email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password) });
    await audit({ actor: actor(req), action: 'admin.create', target: { kind: 'admin', id: String(admin._id) }, after: { email: admin.email, role: admin.role } });
    res.status(201).json({ id: String(admin._id), email: admin.email, name: admin.name, role: admin.role });
  }),
);

adminOpsRouter.post(
  '/admins/:id/active',
  requirePermission('admins.manage'),
  asyncRoute(async (req, res) => {
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    if (String(req.ctx!.id) === String(req.params.id) && !active) throw ApiError.conflict('You cannot deactivate yourself');
    const admin = await AdminUser.findById(req.params.id);
    if (!admin) throw ApiError.notFound('Admin not found');
    admin.active = active;
    await admin.save();
    await audit({ actor: actor(req), action: active ? 'admin.activate' : 'admin.deactivate', target: { kind: 'admin', id: String(admin._id) } });
    res.json({ active });
  }),
);

// ---------- Reports (spec §50) ----------
adminOpsRouter.get(
  '/reports/summary',
  requirePermission('reports.view'),
  asyncRoute(async (req, res) => {
    const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
    const from = q.from ?? new Date(Date.now() - 30 * 24 * 3600_000);
    const to = q.to ?? new Date();
    const range = { $gte: from, $lte: to };
    const [leadFunnel, callStats, callRevenue, recharges, creditsConsumed, driverActivity, leadByCity, leadByVehicle] = await Promise.all([
      Lead.aggregate<{ _id: string; n: number }>([{ $match: { createdAt: range } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Call.aggregate<{ _id: { status: string; classification: string }; n: number }>([
        { $match: { initiatedAt: range } },
        { $group: { _id: { status: '$status', classification: '$billing.classification' }, n: { $sum: 1 } } },
      ]),
      WalletTransaction.aggregate<{ _id: null; paise: number; n: number }>([
        { $match: { kind: 'call_charge', createdAt: range } },
        { $group: { _id: null, paise: { $sum: { $abs: '$amountPaise' } }, n: { $sum: 1 } } },
      ]),
      Payment.aggregate<{ _id: null; paise: number; n: number }>([
        { $match: { status: 'verified', verifiedAt: range } },
        { $group: { _id: null, paise: { $sum: '$amountPaise' }, n: { $sum: 1 } } },
      ]),
      WalletTransaction.aggregate<{ _id: string; n: number }>([
        { $match: { kind: { $in: ['free_credit_consume', 'promo_credit_consume'] }, createdAt: range } },
        { $group: { _id: '$kind', n: { $sum: 1 } } },
      ]),
      Driver.aggregate<{ _id: string; n: number }>([{ $match: { createdAt: range } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Lead.aggregate<{ _id: string | null; n: number }>([
        { $match: { createdAt: range } },
        { $lookup: { from: 'drivers', localField: 'driverId', foreignField: '_id', as: 'driver' } },
        { $group: { _id: { $first: '$driver.city' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 20 },
      ]),
      Lead.aggregate<{ _id: string; n: number }>([{ $match: { createdAt: range } }, { $group: { _id: '$vehicleType', n: { $sum: 1 } } }]),
    ]);
    res.json({
      range: { from, to },
      leads: Object.fromEntries(leadFunnel.map((r) => [r._id, r.n])),
      calls: callStats.map((r) => ({ status: r._id.status, classification: r._id.classification, n: r.n })),
      revenue: {
        callChargesPaise: callRevenue[0]?.paise ?? 0,
        chargedCalls: callRevenue[0]?.n ?? 0,
        rechargesPaise: recharges[0]?.paise ?? 0,
        rechargeCount: recharges[0]?.n ?? 0,
      },
      creditsConsumed: Object.fromEntries(creditsConsumed.map((r) => [r._id, r.n])),
      driverRegistrations: Object.fromEntries(driverActivity.map((r) => [r._id, r.n])),
      geography: { leadsByCity: leadByCity.map((r) => ({ city: r._id ?? 'unknown', n: r.n })), leadsByVehicleType: Object.fromEntries(leadByVehicle.map((r) => [r._id, r.n])) },
    });
  }),
);

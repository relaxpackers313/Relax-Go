import { Router } from 'express';
import { driverRegistrationSchema, documentUploadSchema, driverDecisionSchema } from '@relaxgo/shared';
import { z } from 'zod';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { DriverDocument, Driver, Vehicle } from '../../models/driver.model';
import { Wallet } from '../../models/wallet.model';
import { decideDriver, listDriversForAdmin, registrationState, reviewDocument, submitRegistration, uploadDocument } from './drivers.service';
import { uploadDocumentImage } from '../../services/storage';

/** Routes the signed-in driver uses for their own onboarding/status. */
export const driverSelfRouter: Router = Router();
driverSelfRouter.use(requireAuth('driver'));

driverSelfRouter.get(
  '/me',
  asyncRoute(async (req, res) => {
    const d = req.ctx!.driver!;
    const wallet = await Wallet.findOne({ driverId: d._id });
    const { getSettings } = await import('../settings/settings.service');
    const { periodStart } = await import('../pricing/pricing.service');
    const { Call } = await import('../../models/lead.model');
    const { trusted } = await import('../../lib/mongo');
    const settings = await getSettings();
    const dayStart = periodStart('day', settings.calls.allowanceTzOffsetMinutes);
    const [callsToday, freeUsedToday] = await Promise.all([
      Call.countDocuments({ driverId: d._id, initiatedAt: trusted({ $gte: dayStart }) }),
      Call.countDocuments({ driverId: d._id, initiatedAt: trusted({ $gte: dayStart }), 'billing.classification': 'free', 'billing.freeSource': 'daily' }),
    ]);
    res.json({
      id: String(d._id),
      phone: d.phone,
      status: d.status,
      statusReason: d.statusReason ?? null,
      fullName: d.fullName ?? null,
      city: d.city ?? null,
      vehicleType: d.vehicleType ?? null,
      registrationNumber: d.registrationNumber ?? null,
      rating: d.rating,
      wallet: wallet ? { balancePaise: wallet.balancePaise, freeCredits: wallet.freeCredits, promoCredits: wallet.promoCredits } : null,
      today: {
        calls: callsToday,
        freeCallsRemaining: Math.max(0, settings.calls.freeCallsPerDay - freeUsedToday),
        freeCallsPerDay: settings.calls.freeCallsPerDay,
      },
    });
  }),
);

/**
 * Zone awareness for the driver home map: other ONLINE drivers around this driver's own live
 * position ("competitor traffic") plus anonymous live customer demand (recent discovery
 * searches nearby). Deliberately anonymous in both directions — vehicle type / position /
 * recency only, no names, plates, photos or numbers: the purpose is density, not identification.
 */
driverSelfRouter.get(
  '/nearby',
  asyncRoute(async (req, res) => {
    const { DriverLocation } = await import('../../models/location.model');
    const mine = await DriverLocation.findOne({ driverId: req.ctx!.id });
    if (!mine?.location?.coordinates) return res.json({ me: null, drivers: [], customers: [], radiusKm: 0 });
    const [lng, lat] = mine.location.coordinates as [number, number];
    const { discoverDrivers } = await import('../discovery/discovery.service');
    const { trusted } = await import('../../lib/mongo');
    const { CustomerSession } = await import('../../models/customer.model');
    const radiusKm = 5;
    const demandWindowMs = 30 * 60_000;
    const [{ drivers }, searchers] = await Promise.all([
      discoverDrivers({ lat, lng, radiusKm }),
      CustomerSession.find({
        'lastSearch.at': trusted({ $gte: new Date(Date.now() - demandWindowMs) }),
        'lastSearch.location': trusted({
          $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radiusKm * 1000 },
        }),
      })
        .select('lastSearch')
        .limit(50),
    ]);
    res.json({
      me: { lat, lng },
      radiusKm,
      drivers: drivers
        .filter((d) => d.driverId !== req.ctx!.id)
        .map((d) => ({
          vehicleType: d.vehicleType,
          distanceKm: d.distanceKm,
          location: d.location,
          heading: d.heading ?? null,
        })),
      customers: searchers
        .filter((s) => s.lastSearch?.location?.coordinates?.length === 2)
        .map((s) => ({
          location: { lat: s.lastSearch!.location!.coordinates![1], lng: s.lastSearch!.location!.coordinates![0] },
          vehicleType: s.lastSearch!.vehicleType ?? null,
          minutesAgo: Math.max(0, Math.round((Date.now() - (s.lastSearch!.at?.getTime() ?? Date.now())) / 60_000)),
        })),
    });
  }),
);

driverSelfRouter.get(
  '/registration',
  asyncRoute(async (req, res) => {
    res.json(await registrationState(req.ctx!.id));
  }),
);

driverSelfRouter.put(
  '/registration',
  asyncRoute(async (req, res) => {
    const input = parse(driverRegistrationSchema, req.body);
    res.json(await submitRegistration(req.ctx!.id, input));
  }),
);

/** Accepts the raw image (base64) and returns the stored URL to attach to a document. */
driverSelfRouter.post(
  '/uploads',
  asyncRoute(async (req, res) => {
    const { base64, mimeType } = parse(z.object({ base64: z.string().min(10).max(12_000_000), mimeType: z.string().max(60) }), req.body);
    res.status(201).json(await uploadDocumentImage({ base64, mimeType, driverId: req.ctx!.id }));
  }),
);

driverSelfRouter.post(
  '/documents',
  asyncRoute(async (req, res) => {
    const input = parse(documentUploadSchema, req.body);
    res.status(201).json(await uploadDocument(req.ctx!.id, input));
  }),
);

/** Admin driver management. */
export const adminDriversRouter: Router = Router();
adminDriversRouter.use(requireAuth('admin'));

const listQuerySchema = z.object({
  status: z.string().optional(),
  city: z.string().optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

adminDriversRouter.get(
  '/',
  requirePermission('drivers.view'),
  asyncRoute(async (req, res) => {
    res.json(await listDriversForAdmin(parse(listQuerySchema, req.query)));
  }),
);

adminDriversRouter.get(
  '/:id',
  requirePermission('drivers.view'),
  asyncRoute(async (req, res) => {
    const driver = await Driver.findById(req.params.id);
    if (!driver) throw ApiError.notFound('Driver not found');
    const [documents, vehicles, wallet, registration] = await Promise.all([
      DriverDocument.find({ driverId: driver._id }).sort({ createdAt: -1 }),
      Vehicle.find({ driverId: driver._id }).sort({ createdAt: -1 }),
      Wallet.findOne({ driverId: driver._id }),
      registrationState(String(driver._id)),
    ]);
    res.json({ driver, documents, vehicles, wallet, registration });
  }),
);

adminDriversRouter.post(
  '/:id/decision',
  requirePermission('drivers.approve'),
  asyncRoute(async (req, res) => {
    const { action, reason } = parse(driverDecisionSchema, req.body);
    const admin = req.ctx!.admin!;
    if (['suspend', 'block'].includes(action) && !admin.permissions.includes('drivers.suspend') && admin.role !== 'superadmin' && admin.role !== 'operations') {
      throw ApiError.forbidden('Missing permission: drivers.suspend');
    }
    res.json(await decideDriver({ kind: 'admin', id: req.ctx!.id, name: admin.name }, req.params.id as string, action, reason));
  }),
);

/** Support-desk password reset (no SMS channel yet): audited, and the new password is told to the driver over a verified support call. */
adminDriversRouter.post(
  '/:id/reset-password',
  requirePermission('drivers.edit'),
  asyncRoute(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(8).max(200) }), req.body);
    const driver = await Driver.findById(req.params.id);
    if (!driver) throw ApiError.notFound('Driver not found');
    const { hashPassword } = await import('../../lib/passwords');
    // A Firebase-era account simply gains a password without losing OTP sign-in.
    driver.passwordHash = await hashPassword(password);
    await driver.save();
    const { audit } = await import('../../lib/audit');
    await audit({ actor: { kind: 'admin', id: req.ctx!.id, name: req.ctx!.admin?.name }, action: 'driver.password_reset', target: { kind: 'driver', id: String(driver._id) } });
    res.json({ ok: true });
  }),
);

adminDriversRouter.post(
  '/:id/flags',
  requirePermission('drivers.edit'),
  asyncRoute(async (req, res) => {
    const { flag, action } = parse(z.object({ flag: z.string().min(2).max(40), action: z.enum(['add', 'remove']) }), req.body);
    const driver = await Driver.findById(req.params.id);
    if (!driver) throw ApiError.notFound('Driver not found');
    await Driver.updateOne({ _id: driver._id }, action === 'add' ? { $addToSet: { flags: flag } } : { $pull: { flags: flag } });
    const { audit } = await import('../../lib/audit');
    await audit({ actor: { kind: 'admin', id: req.ctx!.id, name: req.ctx!.admin?.name }, action: `driver.flag.${action}`, target: { kind: 'driver', id: String(driver._id) }, after: { flag } });
    res.json({ ok: true });
  }),
);

adminDriversRouter.post(
  '/documents/:documentId/review',
  requirePermission('drivers.documents.review'),
  asyncRoute(async (req, res) => {
    const { decision, reason } = parse(z.object({ decision: z.enum(['verified', 'rejected']), reason: z.string().max(500).optional() }), req.body);
    const admin = req.ctx!.admin!;
    res.json(await reviewDocument({ kind: 'admin', id: req.ctx!.id, name: admin.name }, req.params.documentId as string, decision, reason));
  }),
);

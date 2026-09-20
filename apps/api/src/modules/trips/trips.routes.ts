import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { tripActionSchema, type TripStatus } from '@relaxgo/shared';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth, requireApprovedDriver } from '../../middleware/auth';
import { Lead, Trip } from '../../models/lead.model';
import { DriverLocation } from '../../models/location.model';
import { Driver } from '../../models/driver.model';
import { transitionLead } from '../leads/leads.service';
import { getSettings } from '../settings/settings.service';
import { fromGeoPoint } from '../../models/geo';

/** Driver-side transitions; a trip only ever moves forward (spec §56). */
const ACTION_TO_STATUS: Record<string, TripStatus> = {
  en_route: 'driver_en_route',
  arrived: 'arrived',
  start: 'started',
  complete: 'completed',
  cancel: 'cancelled',
};
const ORDER: TripStatus[] = ['lead_generated', 'driver_contacted', 'driver_confirmed', 'driver_en_route', 'arrived', 'started', 'completed'];

export const driverTripsRouter: Router = Router();
driverTripsRouter.use(requireAuth('driver'), requireApprovedDriver);

/** Confirm a contacted/accepted lead into a trip; the lead becomes 'converted'. */
driverTripsRouter.post(
  '/from-lead/:leadId',
  asyncRoute(async (req, res) => {
    const settings = await getSettings();
    if (!settings.features.trips) throw ApiError.conflict('Trips are not enabled');
    const lead = await Lead.findOne({ _id: req.params.leadId, driverId: req.ctx!.id });
    if (!lead) throw ApiError.notFound('Lead not found');
    if (!['accepted', 'contacted'].includes(lead.status)) throw ApiError.conflict('Confirm the lead (or call the customer) first');
    const existing = await Trip.findOne({ leadId: lead._id });
    if (existing) return res.status(200).json(existing);
    const trip = await Trip.create({
      leadId: lead._id,
      driverId: lead.driverId,
      customerSessionId: lead.customerSessionId,
      status: 'driver_confirmed',
      statusHistory: [{ status: 'driver_confirmed', at: new Date(), by: { kind: 'driver', id: req.ctx!.id } }],
      shareToken: settings.features.tripSharing ? randomBytes(12).toString('hex') : undefined,
    });
    await transitionLead(lead, 'converted', { kind: 'driver', id: req.ctx!.id });
    res.status(201).json(trip);
  }),
);

driverTripsRouter.post(
  '/:id/action',
  asyncRoute(async (req, res) => {
    const { action } = parse(tripActionSchema, req.body);
    const trip = await Trip.findOne({ _id: req.params.id, driverId: req.ctx!.id });
    if (!trip) throw ApiError.notFound('Trip not found');
    if (['completed', 'cancelled'].includes(trip.status)) throw ApiError.conflict('This trip is closed');
    const to = ACTION_TO_STATUS[action]!;
    if (to !== 'cancelled' && ORDER.indexOf(to) <= ORDER.indexOf(trip.status as TripStatus)) {
      throw ApiError.conflict(`Trip is already ${trip.status}`);
    }
    trip.status = to;
    trip.statusHistory.push({ status: to, at: new Date(), by: { kind: 'driver', id: req.ctx!.id } } as never);
    if (to === 'started') trip.startedAt = new Date();
    if (to === 'completed') trip.completedAt = new Date();
    await trip.save();
    res.json(trip);
  }),
);

driverTripsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ items: await Trip.find({ driverId: req.ctx!.id }).sort({ createdAt: -1 }).limit(100) });
  }),
);

export const customerTripsRouter: Router = Router();
customerTripsRouter.use(requireAuth('customer'));

customerTripsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ items: await Trip.find({ customerSessionId: req.ctx!.id }).sort({ createdAt: -1 }).limit(50) });
  }),
);

customerTripsRouter.post(
  '/:id/cancel',
  asyncRoute(async (req, res) => {
    const trip = await Trip.findOne({ _id: req.params.id, customerSessionId: req.ctx!.id });
    if (!trip) throw ApiError.notFound('Trip not found');
    if (['completed', 'cancelled'].includes(trip.status)) throw ApiError.conflict('This trip is closed');
    trip.status = 'cancelled';
    trip.statusHistory.push({ status: 'cancelled', at: new Date(), by: { kind: 'customer', id: req.ctx!.id } } as never);
    await trip.save();
    res.json(trip);
  }),
);

/** Public share view (spec §36 trip sharing): minimal, token-gated, no contact details. */
export const sharedTripRouter: Router = Router();

/** Human-viewable page for the same token — what family members open from the shared link. */
sharedTripRouter.get(
  '/:token/view',
  asyncRoute(async (req, res) => {
    const token = String(req.params.token).replace(/[^a-f0-9]/gi, '');
    res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relax Go — live trip</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f6f9;color:#0f172a}
.wrap{max-width:480px;margin:0 auto;padding:20px}
.card{background:#fff;border-radius:14px;padding:18px;margin-top:14px;box-shadow:0 4px 12px rgba(15,23,42,.08)}
.brand{font-weight:800;font-size:20px}.brand span{color:#f59e0b}
.status{display:inline-block;background:#ccfbf1;color:#115e59;font-weight:700;border-radius:999px;padding:4px 12px;margin-top:6px}
.row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px}.row b{text-align:right}
a.map{display:block;text-align:center;background:#0f766e;color:#fff;text-decoration:none;border-radius:10px;padding:12px;font-weight:700;margin-top:12px}
.muted{color:#64748b;font-size:12px;margin-top:14px}
</style></head><body><div class="wrap">
<div class="brand">Relax <span>Go</span></div>
<div class="card" id="card">Loading live trip…</div>
<p class="muted">This page shows the trip's live status and vehicle position. It contains no phone numbers. Relax Go is a ChefoTech product operated by Relax Group.</p>
</div><script>
async function load(){
  try{
    const r = await fetch('/api/v1/shared/trips/${token}');
    if(!r.ok){document.getElementById('card').textContent='This shared trip link is no longer available.';return}
    const d = await r.json();
    const loc = d.driverLocation;
    document.getElementById('card').innerHTML =
      '<span class="status">'+d.status.replace(/_/g,' ')+'</span>'+
      '<div class="row"><span>Driver</span><b>'+(d.driver?d.driver.name:'—')+'</b></div>'+
      '<div class="row"><span>Vehicle</span><b>'+(d.driver?(d.driver.vehicleType||'')+' · '+(d.driver.registrationNumber||''):'—')+'</b></div>'+
      '<div class="row"><span>Last update</span><b>'+(d.updatedAt?new Date(d.updatedAt).toLocaleTimeString():'—')+'</b></div>'+
      (loc?'<a class="map" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat='+loc.lat+'&mlon='+loc.lng+'#map=16/'+loc.lat+'/'+loc.lng+'">Open live position on the map</a>':'');
  }catch(e){document.getElementById('card').textContent='Connection lost — retrying…'}
}
load();setInterval(load,10000);
</script></body></html>`);
  }),
);
sharedTripRouter.get(
  '/:token',
  asyncRoute(async (req, res) => {
    const trip = await Trip.findOne({ shareToken: req.params.token });
    if (!trip) throw ApiError.notFound('Shared trip not found');
    const [driver, loc] = await Promise.all([
      Driver.findById(trip.driverId).select('fullName vehicleType vehicleModel registrationNumber'),
      DriverLocation.findOne({ driverId: trip.driverId }),
    ]);
    res.json({
      status: trip.status,
      startedAt: trip.startedAt ?? null,
      driver: driver
        ? { name: driver.fullName, vehicleType: driver.vehicleType, vehicleModel: driver.vehicleModel, registrationNumber: driver.registrationNumber }
        : null,
      driverLocation: loc && !['completed', 'cancelled'].includes(trip.status) ? fromGeoPoint(loc.location as never) : null,
      updatedAt: loc?.receivedAt ?? null,
    });
  }),
);

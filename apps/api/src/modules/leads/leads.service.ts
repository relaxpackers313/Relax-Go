import { Types, type HydratedDocument } from 'mongoose';
import { haversineKm, LEAD_TRANSITIONS, type LeadStatus, OPERATIONAL_DRIVER_STATUSES } from '@relaxgo/shared';
import { Lead, type LeadDoc } from '../../models/lead.model';
import { Driver } from '../../models/driver.model';
import { DriverLocation } from '../../models/location.model';
import { Notification } from '../../models/ops.model';
import { getSettings } from '../settings/settings.service';
import { ApiError } from '../../lib/errors';
import { trusted } from '../../lib/mongo';
import { events } from '../../lib/events';
import { toGeoPoint } from '../../models/geo';
import type { Place } from '@relaxgo/shared';

/** Move a lead along the allowed transition graph, recording who did it (spec §19: auditable transitions). */
export async function transitionLead(
  lead: HydratedDocument<LeadDoc>,
  to: LeadStatus,
  by: { kind: 'customer' | 'driver' | 'admin' | 'system'; id?: string },
  reason?: string,
) {
  const from = lead.status as LeadStatus;
  if (!LEAD_TRANSITIONS[from].includes(to)) {
    throw ApiError.conflict(`A lead cannot go from '${from}' to '${to}'`);
  }
  lead.status = to;
  lead.statusHistory.push({ status: to, at: new Date(), by, reason } as never);
  if (to === 'viewed' && !lead.viewedAt) lead.viewedAt = new Date();
  if (to === 'contacted' && !lead.contactedAt) lead.contactedAt = new Date();
  await lead.save();
  events.emit('lead.status', { leadId: String(lead._id), customerSessionId: String(lead.customerSessionId), driverId: String(lead.driverId), status: to });
  return lead;
}

export async function createLead(
  customerSessionId: string,
  input: { driverId: string; pickup: Place; destination?: Place; vehicleType: string; requirements?: string; contactPhone?: string },
) {
  const settings = await getSettings();

  if (settings.leads.destinationRequired && !input.destination) {
    throw ApiError.unprocessable('Destination is required', { destination: 'Required' });
  }

  const driver = await Driver.findById(input.driverId);
  if (!driver || !OPERATIONAL_DRIVER_STATUSES.includes(driver.status as never)) {
    throw ApiError.unprocessable('This driver is not available right now');
  }

  // Duplicate rule: same session → same driver inside the window.
  if (settings.leads.duplicateWindowMinutes > 0) {
    const since = new Date(Date.now() - settings.leads.duplicateWindowMinutes * 60_000);
    const dup = await Lead.findOne({
      customerSessionId,
      driverId: driver._id,
      createdAt: trusted({ $gte: since }),
      status: trusted({ $in: ['created', 'shown', 'viewed', 'accepted', 'contacted'] }),
    });
    if (dup) throw ApiError.conflict('You already have a recent request with this driver');
  }

  const active = await Lead.countDocuments({
    customerSessionId,
    status: trusted({ $in: ['created', 'shown', 'viewed', 'accepted', 'contacted'] }),
    expiresAt: trusted({ $gt: new Date() }),
  });
  if (active >= settings.leads.maxActivePerCustomer) {
    throw ApiError.conflict('You have too many open requests. Cancel one or wait for it to finish.');
  }

  // Remember the contact number on the session so the next request doesn't ask again.
  if (input.contactPhone) {
    const { CustomerSession } = await import('../../models/customer.model');
    await CustomerSession.updateOne({ _id: customerSessionId, phone: null }, { $set: { phone: input.contactPhone } });
  }

  const lead = await Lead.create({
    customerSessionId,
    driverId: driver._id,
    contactPhone: input.contactPhone,
    pickup: { location: toGeoPoint(input.pickup), address: input.pickup.address },
    destination: input.destination ? { location: toGeoPoint(input.destination), address: input.destination.address } : undefined,
    vehicleType: input.vehicleType,
    requirements: input.requirements,
    distanceKm: 0, // replaced below once we know the driver position; pickup↔driver distance
    status: 'created',
    statusHistory: [{ status: 'created', at: new Date(), by: { kind: 'customer', id: customerSessionId } }],
    expiresAt: new Date(Date.now() + settings.leads.expiryMinutes * 60_000),
  });

  // Distance from the driver's live position to the pickup, when we have one.
  const loc = await DriverLocation.findOne({ driverId: driver._id });
  if (loc) {
    const [lng, lat] = (loc.location as { coordinates: [number, number] }).coordinates;
    lead.distanceKm = Math.round(haversineKm({ lat, lng }, input.pickup) * 100) / 100;
    await lead.save();
  }

  await Notification.create({
    audience: { kind: 'driver', id: String(driver._id) },
    channel: 'in_app',
    type: 'lead.new',
    title: 'New customer request',
    body: `Pickup ${lead.distanceKm ? `${lead.distanceKm} km away` : 'nearby'}${input.pickup.address ? ` — ${input.pickup.address}` : ''}`,
    data: { leadId: String(lead._id) },
  });

  events.emit('lead.created', {
    driverId: String(driver._id),
    leadId: String(lead._id),
    distanceKm: lead.distanceKm || undefined,
    pickupAddress: input.pickup.address,
  });
  return lead;
}

export async function listDriverLeads(driverId: string, status?: string) {
  const query: Record<string, unknown> = { driverId: new Types.ObjectId(driverId) };
  if (status) query.status = status;
  else query.expiresAt = trusted({ $gt: new Date(Date.now() - 24 * 3600_000) });
  // Call privacy (spec §39): the customer's number is never in driver-facing lead payloads.
  const leads = await Lead.find(query).select('-contactPhone').sort({ createdAt: -1 }).limit(100);

  // Leads delivered to the driver list move created → shown (visible in the funnel analytics).
  const fresh = leads.filter((l) => l.status === 'created');
  if (fresh.length) {
    await Lead.updateMany(
      { _id: trusted({ $in: fresh.map((l) => l._id) }), status: 'created' },
      {
        $set: { status: 'shown' },
        $push: { statusHistory: { status: 'shown', at: new Date(), by: { kind: 'system' } } },
      },
    );
    for (const l of fresh) l.status = 'shown';
  }
  return leads;
}

/** Expire overdue leads; called by the periodic worker and cheap enough to run often. */
export async function expireOverdueLeads(): Promise<number> {
  const overdue = await Lead.find({
    status: trusted({ $in: ['created', 'shown', 'viewed', 'accepted'] }),
    expiresAt: trusted({ $lte: new Date() }),
  }).limit(500);
  for (const lead of overdue) {
    await transitionLead(lead, 'expired', { kind: 'system' }, 'Lead expiry window passed');
  }
  return overdue.length;
}

import { Types } from 'mongoose';
import type { CallStatus } from '@relaxgo/shared';
import { Call, Lead } from '../../models/lead.model';
import { CustomerSession } from '../../models/customer.model';
import type { DriverDoc } from '../../models/driver.model';
import { getSettings } from '../settings/settings.service';
import { decideBilling, executeBilling } from './billing.service';
import { transitionLead } from '../leads/leads.service';
import { ApiError } from '../../lib/errors';
import { trusted, withTransaction } from '../../lib/mongo';

/**
 * The tracked-call flow (spec §§20–23): the driver never sees the customer's number in lead
 * payloads; initiating a call runs the full eligibility checklist, bills according to config,
 * records the Call, and only then returns a callable number.
 */
export async function initiateCall(driver: DriverDoc, leadId: string) {
  const settings = await getSettings();
  const driverId = String(driver._id);

  // 7. Lead still valid?
  const lead = await Lead.findOne({ _id: leadId, driverId: driver._id });
  if (!lead) throw ApiError.notFound('Lead not found');
  if (['expired', 'cancelled', 'rejected'].includes(lead.status)) {
    throw ApiError.conflict('This request is no longer active');
  }
  if (lead.expiresAt <= new Date() && !['contacted', 'converted'].includes(lead.status)) {
    throw ApiError.conflict('This request has expired');
  }

  // 8. Customer contact available?
  let phone = lead.contactPhone;
  if (!phone) {
    const session = await CustomerSession.findById(lead.customerSessionId);
    phone = session?.phone ?? undefined;
  }
  if (!phone) throw ApiError.conflict('The customer has not shared a contact number for this request');

  // 10. Duplicate-call window: a re-dial on the same lead is not charged again.
  const dupWindowMs = settings.calls.duplicateCallWindowMinutes * 60_000;
  const recent =
    dupWindowMs > 0
      ? await Call.findOne({ leadId: lead._id, driverId: driver._id, initiatedAt: trusted({ $gte: new Date(Date.now() - dupWindowMs) }) })
      : null;

  // Cooldown between chargeable initiations.
  if (settings.calls.cooldownSeconds > 0 && !recent) {
    const lastCall = await Call.findOne({ driverId: driver._id }).sort({ initiatedAt: -1 });
    if (lastCall && Date.now() - lastCall.initiatedAt.getTime() < settings.calls.cooldownSeconds * 1000) {
      throw ApiError.tooMany('Please wait a moment before the next call');
    }
  }

  const decision = recent
    ? ({ classification: 'unbilled', amountPaise: 0, reasonShown: 'Repeat call — not charged' } as const)
    : await decideBilling(driverId, { vehicleType: lead.vehicleType, city: driver.city ?? undefined, driverCategory: driver.category ?? undefined });

  const chargeNow = !settings.calls.chargeOnlyConnected;

  const call = await withTransaction(async (session) => {
    const [created] = await Call.create(
      [
        {
          leadId: lead._id,
          driverId: driver._id,
          customerSessionId: lead.customerSessionId,
          initiatedAt: new Date(),
          status: 'initiated',
          billing: {
            classification: decision.classification,
            freeSource: 'freeSource' in decision ? decision.freeSource : undefined,
            amountPaise: decision.amountPaise,
            settled: false,
          },
        },
      ],
      { session },
    );
    if (chargeNow) {
      const { walletTransactionId } = await executeBilling(
        { driverId, callId: created!._id, leadId: lead._id, decision },
        session,
      );
      created!.set('billing.walletTransactionId', walletTransactionId);
      created!.set('billing.settled', true);
      await created!.save({ session });
    }
    return created!;
  });

  // Lead moves toward 'contacted' (fast-forwarding shown → viewed when needed).
  if (['created', 'shown'].includes(lead.status)) await transitionLead(lead, 'viewed', { kind: 'driver', id: driverId });
  if (['viewed', 'accepted'].includes(lead.status)) await transitionLead(lead, 'contacted', { kind: 'driver', id: driverId });
  await Lead.updateOne({ _id: lead._id }, { $addToSet: { callIds: call._id } });

  return {
    callId: String(call._id),
    phone,
    charge: {
      classification: decision.classification,
      amountPaise: decision.amountPaise,
      settled: chargeNow,
      message: decision.reasonShown,
    },
  };
}

/**
 * Direct click-to-call (customer → driver): the customer picks a driver on the map and dials
 * immediately — no request form, no booking. A Lead is still created behind the scenes (it IS
 * the billable enquiry) and the driver is billed by exactly the same allowance → credits →
 * wallet ladder as a driver-initiated call. Returns the driver's number for the dialer.
 */
export async function initiateCustomerCall(
  customerSessionId: string,
  input: { driverId: string; pickup: { lat: number; lng: number; address?: string }; vehicleType?: string },
) {
  const settings = await getSettings();
  const { Driver } = await import('../../models/driver.model');
  const driver = await Driver.findById(input.driverId);
  if (!driver || driver.status !== 'approved' || !driver.phone) {
    throw ApiError.unprocessable('This driver is not available right now');
  }
  const driverId = String(driver._id);
  const vehicleType = input.vehicleType ?? driver.vehicleType ?? 'unknown';

  // Reuse the customer's active lead with this driver, else create one (source: click-to-call).
  const { createLead } = await import('../leads/leads.service');
  let lead = await Lead.findOne({
    customerSessionId,
    driverId: driver._id,
    status: trusted({ $in: ['created', 'shown', 'viewed', 'accepted', 'contacted'] }),
    expiresAt: trusted({ $gt: new Date() }),
  }).sort({ createdAt: -1 });
  if (!lead) {
    lead = await createLead(customerSessionId, { driverId, pickup: input.pickup, vehicleType });
    lead.source = 'click_to_call';
    await lead.save();
  }

  // Repeat call to the same driver inside the window is never charged twice.
  const dupWindowMs = settings.calls.duplicateCallWindowMinutes * 60_000;
  const recent =
    dupWindowMs > 0
      ? await Call.findOne({
          customerSessionId: lead.customerSessionId,
          driverId: driver._id,
          initiatedAt: trusted({ $gte: new Date(Date.now() - dupWindowMs) }),
        })
      : null;

  let decision;
  try {
    decision = recent
      ? ({ classification: 'unbilled', amountPaise: 0, reasonShown: 'Repeat call — not charged' } as const)
      : await decideBilling(driverId, { vehicleType, city: driver.city ?? undefined, driverCategory: driver.category ?? undefined });
  } catch (err) {
    // The driver is out of credits — the customer just needs to pick someone else.
    if (err instanceof ApiError && err.code === 'no_credits') {
      throw ApiError.conflict('This driver cannot take calls right now. Please pick another driver nearby.');
    }
    throw err;
  }

  const chargeNow = !settings.calls.chargeOnlyConnected;
  const call = await withTransaction(async (session) => {
    const [created] = await Call.create(
      [
        {
          leadId: lead!._id,
          driverId: driver._id,
          customerSessionId: lead!.customerSessionId,
          direction: 'customer_to_driver',
          initiatedAt: new Date(),
          status: 'initiated',
          billing: {
            classification: decision.classification,
            freeSource: 'freeSource' in decision ? decision.freeSource : undefined,
            amountPaise: decision.amountPaise,
            settled: false,
          },
        },
      ],
      { session },
    );
    if (chargeNow) {
      const { walletTransactionId } = await executeBilling({ driverId, callId: created!._id, leadId: lead!._id, decision }, session);
      created!.set('billing.walletTransactionId', walletTransactionId);
      created!.set('billing.settled', true);
      await created!.save({ session });
    }
    return created!;
  });

  // The lead is contacted the moment the customer dials.
  if (['created', 'shown'].includes(lead.status)) await transitionLead(lead, 'viewed', { kind: 'system' });
  if (['viewed', 'accepted'].includes(lead.status)) await transitionLead(lead, 'contacted', { kind: 'customer', id: customerSessionId });
  await Lead.updateOne({ _id: lead._id }, { $addToSet: { callIds: call._id } });

  // Tell the driver who is calling and from where.
  const { Notification } = await import('../../models/ops.model');
  await Notification.create({
    audience: { kind: 'driver', id: driverId },
    channel: 'in_app',
    type: 'call.incoming',
    title: 'Customer calling you',
    body: `A customer ${lead.distanceKm ? `${lead.distanceKm} km away ` : ''}is calling about a pickup${input.pickup.address ? ` — ${input.pickup.address}` : ''}.`,
    data: { leadId: String(lead._id), callId: String(call._id) },
  });

  return {
    callId: String(call._id),
    leadId: String(lead._id),
    phone: driver.phone,
    driverName: driver.fullName ?? 'Driver',
  };
}

/** Driver reports what happened; deferred billing (chargeOnlyConnected) settles here. */
export async function reportOutcome(driverId: string, callId: string, status: CallStatus, durationSeconds?: number) {
  const call = await Call.findOne({ _id: callId, driverId });
  if (!call) throw ApiError.notFound('Call not found');
  if (call.status !== 'initiated' && call.status !== 'connected') {
    throw ApiError.conflict('This call has already been closed');
  }
  call.status = status;
  if (durationSeconds !== undefined) call.durationSeconds = durationSeconds;

  const settings = await getSettings();
  const billing = call.billing;
  if (billing && !billing.settled) {
    const connected = status === 'connected' || status === 'completed';
    if (settings.calls.chargeOnlyConnected && connected) {
      await withTransaction(async (session) => {
        const decision = {
          classification: billing.classification as 'free' | 'promo' | 'paid' | 'unbilled',
          amountPaise: billing.amountPaise,
          freeSource: (billing as { freeSource?: 'daily' | 'weekly' | 'monthly' | 'credits' }).freeSource,
          reasonShown: 'Charged on connection',
        };
        const { walletTransactionId } = await executeBilling({ driverId, callId: call._id, leadId: call.leadId ?? undefined, decision }, session);
        call.set('billing.walletTransactionId', walletTransactionId);
        call.set('billing.settled', true);
        await call.save({ session });
      });
    } else {
      // Not connected under charge-only-connected → explicitly unbilled.
      if (settings.calls.chargeOnlyConnected) call.set('billing.classification', 'unbilled');
      call.set('billing.settled', true);
      await call.save();
    }
  } else {
    await call.save();
  }
  return call;
}

export async function listDriverCalls(driverId: string, limit = 50) {
  return Call.find({ driverId: new Types.ObjectId(driverId) }).sort({ initiatedAt: -1 }).limit(Math.min(limit, 200));
}

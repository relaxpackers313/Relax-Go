import { Types } from 'mongoose';
import type { DriverRegistration } from '@relaxgo/shared';
import { Driver, DriverDocument, Vehicle } from '../../models/driver.model';
import { DriverLocation } from '../../models/location.model';
import { Wallet, WalletTransaction } from '../../models/wallet.model';
import { getSettings } from '../settings/settings.service';
import { ApiError } from '../../lib/errors';
import { audit, type Actor } from '../../lib/audit';
import { trusted, withTransaction } from '../../lib/mongo';

/** Driver submits (or resubmits after correction_required) their registration. */
export async function submitRegistration(driverId: string, input: DriverRegistration) {
  const driver = await Driver.findById(driverId);
  if (!driver) throw ApiError.notFound('Driver not found');
  if (!['pending', 'correction_required', 'rejected'].includes(driver.status)) {
    throw ApiError.conflict('Registration can only be edited while it is under review');
  }
  const settings = await getSettings();
  const vehicleType = settings.vehicleTypes.find((v) => v.key === input.vehicle.type && v.active);
  if (!vehicleType) throw ApiError.unprocessable('Unknown vehicle type', { 'vehicle.type': 'Pick one of the supported vehicle types' });
  if (settings.driverOnboarding.requireEmergencyContact && !input.emergencyContact) {
    throw ApiError.unprocessable('Emergency contact is required', { emergencyContact: 'Required' });
  }
  if (settings.driverOnboarding.requireBankDetails && !input.bank) {
    throw ApiError.unprocessable('Bank details are required', { bank: 'Required' });
  }

  driver.set({
    fullName: input.fullName,
    email: input.email,
    dateOfBirth: input.dateOfBirth,
    address: input.address,
    city: input.city,
    emergencyContact: input.emergencyContact,
    bank: input.bank,
    vehicleType: input.vehicle.type,
    vehicleModel: input.vehicle.model,
    registrationNumber: input.vehicle.registrationNumber.toUpperCase(),
    registrationSubmittedAt: new Date(),
  });
  if (driver.status !== 'pending') {
    driver.status = 'pending';
    driver.statusReason = undefined;
    driver.statusChangedAt = new Date();
  }
  await driver.save();

  await Vehicle.updateMany({ driverId: driver._id, active: true }, { $set: { active: false } });
  await Vehicle.create({
    driverId: driver._id,
    type: input.vehicle.type,
    registrationNumber: input.vehicle.registrationNumber,
    model: input.vehicle.model,
  });
  return registrationState(String(driver._id));
}

export async function uploadDocument(driverId: string, input: { type: string; fileUrl: string; number?: string; expiresAt?: string }) {
  const settings = await getSettings();
  const spec = settings.driverOnboarding.requiredDocuments.find((d) => d.key === input.type);
  if (!spec) throw ApiError.unprocessable('Unknown document type', { type: 'Not one of the configured documents' });
  if (spec.expiryTracked && !input.expiresAt) {
    throw ApiError.unprocessable(`${spec.label} needs its expiry date`, { expiresAt: 'Required for this document' });
  }
  const previous = await DriverDocument.findOne({ driverId, type: input.type, supersededBy: null }).sort({ createdAt: -1 });
  const doc = await DriverDocument.create({
    driverId,
    type: input.type,
    fileUrl: input.fileUrl,
    number: input.number,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    status: 'pending',
  });
  if (previous) {
    previous.supersededBy = doc._id;
    await previous.save();
  }
  return doc;
}

/** What the driver sees on the status screen: submission, per-document state, missing items. */
export async function registrationState(driverId: string) {
  const driver = await Driver.findById(driverId);
  if (!driver) throw ApiError.notFound('Driver not found');
  const settings = await getSettings();
  const docs = await DriverDocument.find({ driverId: driver._id, supersededBy: null }).sort({ createdAt: -1 });
  const byType = new Map(docs.map((d) => [d.type, d]));
  const documents = settings.driverOnboarding.requiredDocuments.map((spec) => {
    const doc = byType.get(spec.key);
    return {
      type: spec.key,
      label: spec.label,
      required: spec.required,
      status: doc?.status ?? 'missing',
      rejectionReason: doc?.rejectionReason ?? null,
      expiresAt: doc?.expiresAt ?? null,
    };
  });
  const missingRequired = documents.filter((d) => d.required && (d.status === 'missing' || d.status === 'rejected'));
  return {
    status: driver.status,
    statusReason: driver.statusReason ?? null,
    profileSubmitted: !!driver.registrationSubmittedAt,
    readyForReview: !!driver.registrationSubmittedAt && missingRequired.length === 0,
    documents,
  };
}

const DECISION_TO_STATUS = {
  approve: 'approved',
  reject: 'rejected',
  request_correction: 'correction_required',
  suspend: 'suspended',
  reactivate: 'approved',
  block: 'blocked',
} as const;

/** Admin decision on a driver — audited, and approval grants the configured free credits once. */
export async function decideDriver(
  adminActor: Actor,
  driverId: string,
  action: keyof typeof DECISION_TO_STATUS,
  reason?: string,
) {
  const driver = await Driver.findById(driverId);
  if (!driver) throw ApiError.notFound('Driver not found');
  if ((action === 'reject' || action === 'request_correction') && !reason) {
    throw ApiError.unprocessable('A reason is required so the driver knows what to fix', { reason: 'Required' });
  }
  if (action === 'approve') {
    const state = await registrationState(driverId);
    if (!state.readyForReview) throw ApiError.conflict('Driver has missing or rejected required documents');
  }
  const before = driver.status;
  const next = DECISION_TO_STATUS[action];
  const firstApproval = next === 'approved' && !driver.approvedAt;

  await withTransaction(async (session) => {
    driver.status = next;
    driver.statusReason = reason;
    driver.statusChangedAt = new Date();
    driver.statusChangedBy = adminActor.id ? new Types.ObjectId(adminActor.id) : undefined;
    if (firstApproval) driver.approvedAt = new Date();
    await driver.save({ session });

    if (next !== 'approved') {
      // A non-operational driver must drop out of discovery immediately.
      await DriverLocation.updateOne({ driverId: driver._id }, { $set: { online: false } }, { session });
    }

    if (firstApproval) {
      const settings = await getSettings();
      const grant = settings.calls.freeCreditsOnApproval;
      if (grant > 0) {
        const wallet = await Wallet.findOneAndUpdate(
          { driverId: driver._id },
          { $inc: { freeCredits: grant } },
          { returnDocument: 'after', upsert: true, session },
        );
        await WalletTransaction.create(
          [
            {
              walletId: wallet!._id,
              driverId: driver._id,
              kind: 'free_credit_grant',
              credits: grant,
              balanceAfterPaise: wallet!.balancePaise,
              freeCreditsAfter: wallet!.freeCredits,
              promoCreditsAfter: wallet!.promoCredits,
              note: 'Welcome credits on approval',
            },
          ],
          { session },
        );
      }
    }
    await audit(
      { actor: adminActor, action: `driver.${action}`, target: { kind: 'driver', id: driverId }, before: { status: before }, after: { status: next }, reason },
      session,
    );
  });

  // Tell the driver what happened (spec §34): in-app always, email when we have one.
  const MESSAGES: Record<string, { title: string; body: string }> = {
    approved: { title: 'Registration approved', body: 'You can now go online and receive customer requests. Welcome to Relax Go!' },
    rejected: { title: 'Registration requires changes', body: `Your registration was not approved.${reason ? ` Reason: ${reason}` : ''}` },
    correction_required: { title: 'Correction needed', body: `Please update your registration.${reason ? ` ${reason}` : ''}` },
    suspended: { title: 'Account suspended', body: `Your account is suspended.${reason ? ` Reason: ${reason}` : ''} Contact support for help.` },
    blocked: { title: 'Account blocked', body: 'Your account has been blocked. Contact support.' },
  };
  const msg = MESSAGES[next];
  if (msg) {
    const { Notification } = await import('../../models/ops.model');
    await Notification.create({ audience: { kind: 'driver', id: driverId }, channel: 'in_app', type: `driver.${next}`, title: msg.title, body: msg.body });
    if (driver.email) {
      const { sendEmail } = await import('../../services/email');
      void sendEmail({ to: [{ email: driver.email, name: driver.fullName ?? undefined }], subject: `Relax Go — ${msg.title}`, html: `<p>${msg.body}</p><p>— Relax Go, a ChefoTech product operated by Relax Group</p>` }).catch(() => undefined);
    }
  }
  return { status: next };
}

export async function reviewDocument(adminActor: Actor, documentId: string, decision: 'verified' | 'rejected', reason?: string) {
  const doc = await DriverDocument.findById(documentId);
  if (!doc) throw ApiError.notFound('Document not found');
  if (decision === 'rejected' && !reason) throw ApiError.unprocessable('A rejection reason is required', { reason: 'Required' });
  const before = doc.status;
  doc.status = decision;
  doc.rejectionReason = decision === 'rejected' ? reason : undefined;
  doc.reviewedAt = new Date();
  doc.reviewedBy = adminActor.id ? new Types.ObjectId(adminActor.id) : undefined;
  await doc.save();
  await audit({ actor: adminActor, action: `document.${decision}`, target: { kind: 'driver_document', id: documentId }, before: { status: before }, after: { status: decision }, reason });
  return doc;
}

export async function listDriversForAdmin(filter: { status?: string; city?: string; q?: string; page?: number; limit?: number }) {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.city) query.city = filter.city;
  if (filter.q) {
    const rx = (v: string) => trusted({ $regex: v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });
    query.$or = [{ fullName: rx(filter.q) }, { phone: rx(filter.q) }, { registrationNumber: rx(filter.q.toUpperCase()) }];
  }
  const limit = Math.min(filter.limit ?? 25, 100);
  const page = Math.max(filter.page ?? 1, 1);
  const [items, total] = await Promise.all([
    Driver.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Driver.countDocuments(query),
  ]);
  return { items, total, page, limit };
}

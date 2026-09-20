import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { LEAD_STATUSES, CALL_STATUSES, CALL_CLASSIFICATIONS, TRIP_STATUSES } from '@relaxgo/shared';
import { geoPointSchema } from './geo';

const placeSchema = new Schema(
  { location: { type: geoPointSchema, required: true }, address: { type: String } },
  { _id: false },
);

const statusEventSchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, required: true, default: Date.now },
    by: { kind: { type: String, enum: ['customer', 'driver', 'admin', 'system'] }, id: { type: String } },
    reason: { type: String },
  },
  { _id: false },
);

/** A Lead is customer demand pointed at one driver. Leads ≠ Calls ≠ Trips (CLAUDE.md). */
const leadSchema = new Schema(
  {
    customerSessionId: { type: Types.ObjectId, ref: 'CustomerSession', required: true, index: true },
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    pickup: { type: placeSchema, required: true },
    destination: { type: placeSchema },
    vehicleType: { type: String, required: true },
    requirements: { type: String },
    /** Never sent to the driver in lead payloads — revealed only through tracked call initiation (spec §39). */
    contactPhone: { type: String },
    /** Straight-line km at creation time. */
    distanceKm: { type: Number, required: true },
    roadDistanceKm: { type: Number },
    status: { type: String, enum: LEAD_STATUSES, default: 'created', index: true },
    statusHistory: { type: [statusEventSchema], default: [] },
    viewedAt: { type: Date },
    contactedAt: { type: Date },
    callIds: [{ type: Types.ObjectId, ref: 'Call' }],
    expiresAt: { type: Date, required: true, index: true },
    source: { type: String, default: 'customer_app' },
    zoneId: { type: Types.ObjectId, ref: 'ServiceArea' },
  },
  { timestamps: true },
);
leadSchema.index({ driverId: 1, status: 1, createdAt: -1 });
leadSchema.index({ customerSessionId: 1, driverId: 1, createdAt: -1 });

export type LeadDoc = InferSchemaType<typeof leadSchema> & { _id: Types.ObjectId };
export const Lead = model('Lead', leadSchema);

/** A Call is one tracked, billable contact attempt (spec §20). */
const callSchema = new Schema(
  {
    leadId: { type: Types.ObjectId, ref: 'Lead', index: true },
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    customerSessionId: { type: Types.ObjectId, ref: 'CustomerSession', required: true },
    initiatedAt: { type: Date, required: true, default: Date.now },
    /** Who dialed whom: the classic driver→customer flow, or the customer's direct click-to-call. */
    direction: { type: String, enum: ['driver_to_customer', 'customer_to_driver'], default: 'driver_to_customer' },
    status: { type: String, enum: CALL_STATUSES, default: 'initiated' },
    durationSeconds: { type: Number },
    billing: {
      classification: { type: String, enum: CALL_CLASSIFICATIONS, required: true },
      /** Which free pool covered a 'free' call: recurring allowance or the credit balance. */
      freeSource: { type: String, enum: ['daily', 'weekly', 'monthly', 'credits'] },
      amountPaise: { type: Number, required: true, default: 0 },
      walletTransactionId: { type: Types.ObjectId, ref: 'WalletTransaction' },
      settled: { type: Boolean, default: false },
    },
    providerRef: { type: String },
  },
  { timestamps: true },
);
callSchema.index({ driverId: 1, initiatedAt: -1 });

export type CallDoc = InferSchemaType<typeof callSchema> & { _id: Types.ObjectId };
export const Call = model('Call', callSchema);

/** Optional operational trip lifecycle on top of a converted lead (spec §56). */
const tripSchema = new Schema(
  {
    leadId: { type: Types.ObjectId, ref: 'Lead', required: true, unique: true },
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    customerSessionId: { type: Types.ObjectId, ref: 'CustomerSession', required: true },
    status: { type: String, enum: TRIP_STATUSES, default: 'lead_generated' },
    statusHistory: { type: [statusEventSchema], default: [] },
    startedAt: { type: Date },
    completedAt: { type: Date },
    shareToken: { type: String, index: true, sparse: true },
  },
  { timestamps: true },
);

export type TripDoc = InferSchemaType<typeof tripSchema> & { _id: Types.ObjectId };
export const Trip = model('Trip', tripSchema);

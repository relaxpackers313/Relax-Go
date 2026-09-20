import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { geoPointSchema } from './geo';

/**
 * The LIVE location store: exactly one row per driver, updated by upsert on every accepted
 * batch — this collection is what $geoNear discovery queries hit. History lives separately,
 * sampled and TTL-bounded (CLAUDE.md rule 5: never one row per GPS tick).
 */
const driverLocationSchema = new Schema(
  {
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, unique: true },
    location: { type: geoPointSchema, required: true },
    accuracy: { type: Number },
    heading: { type: Number },
    speed: { type: Number },
    battery: { type: Number },
    source: { type: String, enum: ['foreground', 'background'], default: 'foreground' },
    /** Device clock when the fix was taken. */
    recordedAt: { type: Date, required: true },
    /** Server clock when we stored it — freshness/staleness is judged on this. */
    receivedAt: { type: Date, required: true, default: Date.now },
    online: { type: Boolean, default: false, index: true },
  },
  { timestamps: false },
);
driverLocationSchema.index({ location: '2dsphere' });

export type DriverLocationDoc = InferSchemaType<typeof driverLocationSchema> & { _id: Types.ObjectId };
export const DriverLocation = model('DriverLocation', driverLocationSchema);

const locationHistorySchema = new Schema(
  {
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true },
    location: { type: geoPointSchema, required: true },
    accuracy: { type: Number },
    speed: { type: Number },
    source: { type: String, enum: ['foreground', 'background'] },
    recordedAt: { type: Date, required: true },
  },
  { timestamps: false },
);
locationHistorySchema.index({ driverId: 1, recordedAt: -1 });
// Retention default 30 days; the admin setting adjusts sampling, and a retention change
// recreates this index via the maintenance task (TTL is fixed per index by MongoDB).
locationHistorySchema.index({ recordedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export type LocationHistoryDoc = InferSchemaType<typeof locationHistorySchema> & { _id: Types.ObjectId };
export const LocationHistory = model('LocationHistory', locationHistorySchema);

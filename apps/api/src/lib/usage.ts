import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { isTest } from '../config/env';

/**
 * Lightweight usage metering: cheap in-memory counters flushed to Mongo every 30s as daily
 * buckets, so the admin dashboard can show map-provider spend drivers, cache savings and
 * server traffic without adding a write per request.
 */
const usageStatSchema = new Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    kind: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true },
);
usageStatSchema.index({ day: 1, kind: 1 }, { unique: true });

export type UsageStatDoc = InferSchemaType<typeof usageStatSchema> & { _id: Types.ObjectId };
export const UsageStat = model('UsageStat', usageStatSchema);

const pending = new Map<string, number>();

export function bumpUsage(kind: string, n = 1) {
  pending.set(kind, (pending.get(kind) ?? 0) + n);
}

export async function flushUsage() {
  if (pending.size === 0) return;
  const day = new Date().toISOString().slice(0, 10);
  const entries = [...pending.entries()];
  pending.clear();
  await Promise.all(
    entries.map(([kind, count]) => UsageStat.updateOne({ day, kind }, { $inc: { count } }, { upsert: true }).exec()),
  ).catch(() => undefined); // metering must never break the API
}

if (!isTest) setInterval(() => void flushUsage(), 30_000).unref();

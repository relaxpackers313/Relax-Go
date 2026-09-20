import { Schema, model, type InferSchemaType, Types } from 'mongoose';

/** Single versioned configuration document validated by the shared platformSettingsSchema. */
const platformSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    data: { type: Schema.Types.Mixed, required: true },
    version: { type: Number, required: true, default: 1 },
    updatedBy: { type: Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true, minimize: false },
);

export type PlatformSettingsDoc = InferSchemaType<typeof platformSettingsSchema> & { _id: Types.ObjectId };
export const PlatformSettingsModel = model('PlatformSettings', platformSettingsSchema);

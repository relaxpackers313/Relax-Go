import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Customers are anonymous sessions (spec §72): device/session identity, no mandatory account.
 * Phone is captured only when an operation requires verification; a real account can attach later.
 */
const customerSessionSchema = new Schema(
  {
    deviceInfo: {
      platform: { type: String, enum: ['android', 'ios', 'web'] },
      model: String,
      appVersion: String,
    },
    phone: { type: String, index: true, sparse: true },
    phoneVerifiedAt: { type: Date },
    name: { type: String, trim: true },
    blocked: { type: Boolean, default: false },
    blockedReason: { type: String },
    favorites: [
      {
        label: { type: String, required: true },
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        address: String,
      },
    ],
    pushToken: { type: String },
    lastSeenAt: { type: Date, default: Date.now },
    /** Last driver-discovery search: lets drivers see anonymous live demand around them. */
    lastSearch: {
      location: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number] } },
      vehicleType: { type: String },
      at: { type: Date },
    },
  },
  { timestamps: true },
);
customerSessionSchema.index({ 'lastSearch.location': '2dsphere' }, { sparse: true });

export type CustomerSessionDoc = InferSchemaType<typeof customerSessionSchema> & { _id: import('mongoose').Types.ObjectId };
export const CustomerSession = model('CustomerSession', customerSessionSchema);

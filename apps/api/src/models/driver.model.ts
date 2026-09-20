import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { DRIVER_STATUSES, DOCUMENT_STATUSES } from '@relaxgo/shared';

const driverSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true },
    /** Real Firebase uid in firebase mode; synthetic `pw:<phone>` for password-mode drivers. */
    firebaseUid: { type: String, required: true, unique: true },
    passwordHash: { type: String },
    status: { type: String, enum: DRIVER_STATUSES, default: 'pending', index: true },
    statusReason: { type: String },
    statusChangedAt: { type: Date },
    statusChangedBy: { type: Types.ObjectId, ref: 'AdminUser' },

    fullName: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    photoUrl: { type: String },
    dateOfBirth: { type: String },
    address: { type: String },
    city: { type: String, index: true },
    emergencyContact: { name: String, phone: String },
    bank: { accountHolder: String, accountNumber: String, ifsc: String },

    /** Denormalized from the active vehicle for list/discovery reads. */
    vehicleType: { type: String, index: true },
    vehicleModel: { type: String },
    registrationNumber: { type: String },

    category: { type: String, default: 'standard' },
    serviceAreaIds: [{ type: Types.ObjectId, ref: 'ServiceArea' }],
    rating: {
      average: { type: Number, default: null },
      count: { type: Number, default: 0 },
    },
    flags: [{ type: String }],
    registrationSubmittedAt: { type: Date },
    pushToken: { type: String },
    approvedAt: { type: Date },
  },
  { timestamps: true },
);

export type DriverDoc = InferSchemaType<typeof driverSchema> & { _id: Types.ObjectId };
export const Driver = model('Driver', driverSchema);

const driverDocumentSchema = new Schema(
  {
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    type: { type: String, required: true },
    fileUrl: { type: String, required: true },
    number: { type: String },
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'pending', index: true },
    rejectionReason: { type: String },
    expiresAt: { type: Date },
    reviewedBy: { type: Types.ObjectId, ref: 'AdminUser' },
    reviewedAt: { type: Date },
    /** A re-upload supersedes the previous row; history is preserved as rows. */
    supersededBy: { type: Types.ObjectId, ref: 'DriverDocument' },
  },
  { timestamps: true },
);
driverDocumentSchema.index({ driverId: 1, type: 1, createdAt: -1 });

export type DriverDocumentDoc = InferSchemaType<typeof driverDocumentSchema> & { _id: Types.ObjectId };
export const DriverDocument = model('DriverDocument', driverDocumentSchema);

const vehicleSchema = new Schema(
  {
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    type: { type: String, required: true },
    registrationNumber: { type: String, required: true, uppercase: true, trim: true },
    model: { type: String },
    imageUrl: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
vehicleSchema.index({ registrationNumber: 1 });

export type VehicleDoc = InferSchemaType<typeof vehicleSchema> & { _id: Types.ObjectId };
export const Vehicle = model('Vehicle', vehicleSchema);

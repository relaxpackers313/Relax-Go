import { Schema, model, type InferSchemaType } from 'mongoose';
import { ADMIN_ROLES, PERMISSIONS } from '@relaxgo/shared';

const adminUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ADMIN_ROLES, required: true, default: 'operations' },
    /** Extra grants on top of the role bundle. */
    permissions: { type: [String], enum: PERMISSIONS, default: [] },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export type AdminUserDoc = InferSchemaType<typeof adminUserSchema> & { _id: import('mongoose').Types.ObjectId };
export const AdminUser = model('AdminUser', adminUserSchema);

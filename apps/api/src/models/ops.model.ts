import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { TICKET_STATUSES } from '@relaxgo/shared';
import { events } from '../lib/events';

const polygonSchema = new Schema(
  {
    type: { type: String, enum: ['Polygon'], required: true, default: 'Polygon' },
    coordinates: { type: [[[Number]]], required: true },
  },
  { _id: false },
);

/** Cities/zones with polygon or circle geometry; drives eligibility, pricing and lead availability (spec §32). */
const serviceAreaSchema = new Schema(
  {
    name: { type: String, required: true },
    city: { type: String, required: true, index: true },
    kind: { type: String, enum: ['polygon', 'circle'], required: true },
    polygon: { type: polygonSchema },
    center: { lat: Number, lng: Number },
    radiusKm: { type: Number },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
serviceAreaSchema.index({ polygon: '2dsphere' }, { sparse: true });

export type ServiceAreaDoc = InferSchemaType<typeof serviceAreaSchema> & { _id: Types.ObjectId };
export const ServiceArea = model('ServiceArea', serviceAreaSchema);

const notificationSchema = new Schema(
  {
    audience: {
      kind: { type: String, enum: ['driver', 'customer', 'admin'], required: true },
      id: { type: String, required: true },
    },
    channel: { type: String, enum: ['push', 'email', 'in_app', 'sms'], required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String },
    data: { type: Schema.Types.Mixed },
    sentAt: { type: Date },
    readAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true },
);
notificationSchema.index({ 'audience.kind': 1, 'audience.id': 1, createdAt: -1 });

notificationSchema.post('save', function () {
  const kind = this.audience?.kind;
  if (kind === 'driver' || kind === 'customer') {
    events.emit('notification.created', { audienceKind: kind, audienceId: this.audience!.id!, title: this.title, body: this.body ?? undefined, type: this.type });
  }
});

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & { _id: Types.ObjectId };
export const Notification = model('Notification', notificationSchema);

const supportTicketSchema = new Schema(
  {
    raisedBy: {
      kind: { type: String, enum: ['driver', 'customer'], required: true },
      id: { type: String, required: true },
    },
    category: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
    assigneeId: { type: Types.ObjectId, ref: 'AdminUser' },
    messages: [
      {
        from: { kind: { type: String, enum: ['driver', 'customer', 'admin'], required: true }, id: String },
        body: { type: String, required: true },
        at: { type: Date, default: Date.now },
      },
    ],
    ref: { leadId: { type: Types.ObjectId }, callId: { type: Types.ObjectId }, paymentId: { type: Types.ObjectId } },
  },
  { timestamps: true },
);

export type SupportTicketDoc = InferSchemaType<typeof supportTicketSchema> & { _id: Types.ObjectId };
export const SupportTicket = model('SupportTicket', supportTicketSchema);

const ratingSchema = new Schema(
  {
    leadId: { type: Types.ObjectId, ref: 'Lead', required: true, unique: true },
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    customerSessionId: { type: Types.ObjectId, ref: 'CustomerSession', required: true },
    stars: { type: Number, min: 1, max: 5, required: true },
    review: { type: String, maxlength: 1000 },
    flagged: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type RatingDoc = InferSchemaType<typeof ratingSchema> & { _id: Types.ObjectId };
export const Rating = model('Rating', ratingSchema);

/** Sensitive admin/business actions with before/after (spec §53, §69). */
const auditLogSchema = new Schema(
  {
    actor: {
      kind: { type: String, enum: ['admin', 'driver', 'customer', 'system'], required: true },
      id: { type: String },
      name: { type: String },
    },
    action: { type: String, required: true, index: true },
    target: { kind: { type: String }, id: { type: String } },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    reason: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ 'target.kind': 1, 'target.id': 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };
export const AuditLog = model('AuditLog', auditLogSchema);

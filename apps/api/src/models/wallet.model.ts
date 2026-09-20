import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { WALLET_TX_KINDS, PAYMENT_STATUSES } from '@relaxgo/shared';

/**
 * Wallet is a cached view; WalletTransaction is the truth. Every balance/credit change happens
 * inside a MongoDB transaction that writes both (CLAUDE.md rule 2).
 */
const walletSchema = new Schema(
  {
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, unique: true },
    balancePaise: { type: Number, required: true, default: 0 },
    freeCredits: { type: Number, required: true, default: 0 },
    promoCredits: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export type WalletDoc = InferSchemaType<typeof walletSchema> & { _id: Types.ObjectId };
export const Wallet = model('Wallet', walletSchema);

const walletTransactionSchema = new Schema(
  {
    walletId: { type: Types.ObjectId, ref: 'Wallet', required: true, index: true },
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    kind: { type: String, enum: WALLET_TX_KINDS, required: true },
    /** Money movement in paise (0 for pure credit-count changes). */
    amountPaise: { type: Number, required: true, default: 0 },
    /** Credit-count movement (free/promo), signed. */
    credits: { type: Number, required: true, default: 0 },
    balanceAfterPaise: { type: Number, required: true },
    freeCreditsAfter: { type: Number, required: true },
    promoCreditsAfter: { type: Number, required: true },
    ref: {
      callId: { type: Types.ObjectId, ref: 'Call' },
      leadId: { type: Types.ObjectId, ref: 'Lead' },
      paymentId: { type: Types.ObjectId, ref: 'Payment' },
      adminId: { type: Types.ObjectId, ref: 'AdminUser' },
    },
    note: { type: String },
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);
walletTransactionSchema.index({ driverId: 1, createdAt: -1 });
walletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export type WalletTransactionDoc = InferSchemaType<typeof walletTransactionSchema> & { _id: Types.ObjectId };
export const WalletTransaction = model('WalletTransaction', walletTransactionSchema);

/** Gateway payment record; the wallet is credited only after server-side verification (spec §25). */
const paymentSchema = new Schema(
  {
    driverId: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    gateway: { type: String, required: true },
    gatewayOrderId: { type: String, required: true, unique: true },
    gatewayPaymentId: { type: String },
    amountPaise: { type: Number, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created', index: true },
    verifiedAt: { type: Date },
    webhookReceivedAt: { type: Date },
    failureReason: { type: String },
  },
  { timestamps: true },
);

export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: Types.ObjectId };
export const Payment = model('Payment', paymentSchema);

/** Configurable call pricing (spec §26): highest priority active rule that matches wins; fallback is calls.basePricePaise. */
const pricingRuleSchema = new Schema(
  {
    name: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    priority: { type: Number, required: true, default: 0 },
    match: {
      vehicleType: { type: String },
      city: { type: String },
      zoneId: { type: Types.ObjectId, ref: 'ServiceArea' },
      driverCategory: { type: String },
      /** Local hours [from, to) — e.g. 22 → 6 for night pricing. */
      hourFrom: { type: Number, min: 0, max: 23 },
      hourTo: { type: Number, min: 0, max: 24 },
    },
    pricePaise: { type: Number, required: true, min: 0 },
    createdBy: { type: Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true },
);
pricingRuleSchema.index({ active: 1, priority: -1 });

export type PricingRuleDoc = InferSchemaType<typeof pricingRuleSchema> & { _id: Types.ObjectId };
export const PricingRule = model('PricingRule', pricingRuleSchema);

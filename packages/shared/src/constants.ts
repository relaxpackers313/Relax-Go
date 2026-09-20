/** Enumerations of the domain. Business VALUES (radius, prices, credits…) live in config.ts, not here. */

export const DRIVER_STATUSES = ['pending', 'approved', 'rejected', 'correction_required', 'suspended', 'blocked'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/** Statuses in which a driver may appear in customer discovery (when also online + fresh). */
export const OPERATIONAL_DRIVER_STATUSES: readonly DriverStatus[] = ['approved'];

export const PRESENCE_STATES = ['active', 'background', 'stale', 'offline'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export const LEAD_STATUSES = ['created', 'shown', 'viewed', 'accepted', 'rejected', 'contacted', 'converted', 'expired', 'cancelled'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Allowed lead transitions; anything else is a bug and is rejected. */
export const LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  created: ['shown', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled'],
  shown: ['viewed', 'accepted', 'rejected', 'expired', 'cancelled'],
  viewed: ['accepted', 'rejected', 'contacted', 'expired', 'cancelled'],
  accepted: ['contacted', 'converted', 'expired', 'cancelled'],
  rejected: [],
  contacted: ['converted', 'expired', 'cancelled'],
  converted: [],
  expired: [],
  cancelled: [],
};

export const CALL_STATUSES = ['initiated', 'connected', 'no_answer', 'failed', 'completed', 'cancelled'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_CLASSIFICATIONS = ['free', 'promo', 'paid', 'unbilled'] as const;
export type CallClassification = (typeof CALL_CLASSIFICATIONS)[number];

export const TRIP_STATUSES = ['requested', 'lead_generated', 'driver_contacted', 'driver_confirmed', 'customer_confirmed', 'driver_en_route', 'arrived', 'started', 'completed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const WALLET_TX_KINDS = ['recharge', 'call_charge', 'refund', 'admin_adjustment', 'free_credit_grant', 'free_credit_consume', 'promo_credit_grant', 'promo_credit_consume', 'credit_expiry'] as const;
export type WalletTxKind = (typeof WALLET_TX_KINDS)[number];

export const DOCUMENT_STATUSES = ['pending', 'verified', 'rejected', 'expired'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const PAYMENT_STATUSES = ['created', 'pending', 'verified', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TICKET_STATUSES = ['open', 'assigned', 'resolved', 'escalated', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km — the quick proximity measure; road distance is a routing-provider concern. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

import { z } from 'zod';

/** Request/response schemas shared by the API and the three clients. */

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export const placeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(300).optional(),
});
export type Place = z.infer<typeof placeSchema>;

// --- Auth ---

export const adminLoginSchema = z.object({
  email: z.email().max(120),
  password: z.string().min(8).max(200),
});

export const driverFirebaseLoginSchema = z.object({
  /** Firebase Phone Auth ID token, verified server-side. */
  idToken: z.string().min(10).max(4096),
});

export const phoneSchema = z
  .string()
  .transform((v) => (v.startsWith('+') ? v : `+91${v.replace(/\D/g, '')}`))
  .pipe(z.string().regex(/^\+\d{10,15}$/, 'Enter a valid mobile number'));

export const driverPasswordSignupSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(8, 'At least 8 characters').max(200),
});

export const driverPasswordLoginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(200),
});

export const customerSessionSchema = z.object({
  deviceInfo: z
    .object({
      platform: z.enum(['android', 'ios', 'web']).optional(),
      model: z.string().max(120).optional(),
      appVersion: z.string().max(40).optional(),
    })
    .optional(),
});

// --- Driver onboarding ---

export const driverRegistrationSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.email().max(120).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  address: z.string().min(5).max(300),
  city: z.string().min(2).max(80),
  emergencyContact: z
    .object({ name: z.string().min(2).max(120), phone: z.string().min(8).max(20) })
    .optional(),
  vehicle: z.object({
    type: z.string().min(1).max(30),
    registrationNumber: z.string().min(4).max(20),
    model: z.string().max(80).optional(),
  }),
  bank: z
    .object({
      accountHolder: z.string().min(2).max(120),
      accountNumber: z.string().min(6).max(24),
      ifsc: z.string().min(6).max(16),
    })
    .optional(),
});
export type DriverRegistration = z.infer<typeof driverRegistrationSchema>;

export const documentUploadSchema = z.object({
  type: z.string().min(1).max(40),
  fileUrl: z.string().url().max(500),
  number: z.string().max(60).optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const driverDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'request_correction', 'suspend', 'reactivate', 'block']),
  reason: z.string().max(500).optional(),
});

// --- Location ---

export const locationPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().max(10_000).optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(400).optional(),
  battery: z.number().min(0).max(100).optional(),
  recordedAt: z.coerce.date(),
  source: z.enum(['foreground', 'background']).default('foreground'),
});

export const locationBatchSchema = z.object({
  points: z.array(locationPointSchema).min(1).max(50),
});

export const presenceSchema = z.object({ online: z.boolean() });

// --- Discovery ---

export const discoveryQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().optional(),
  vehicleType: z.string().max(30).optional(),
});

export interface DiscoveredDriver {
  driverId: string;
  name: string;
  photoUrl?: string;
  vehicleType: string;
  vehicleModel?: string;
  registrationNumber?: string;
  rating: { average: number | null; count: number };
  distanceKm: number;
  roadDistanceKm?: number;
  etaMinutes?: number;
  location: LatLng;
  lastSeenSecondsAgo: number;
  heading?: number | null;
  presence: 'active' | 'background';
}

// --- Leads ---

export const leadCreateSchema = z.object({
  driverId: z.string().length(24),
  pickup: placeSchema,
  destination: placeSchema.optional(),
  vehicleType: z.string().max(30),
  requirements: z.string().max(500).optional(),
  /** How the driver reaches the customer; falls back to the session's phone. Only ever revealed through call initiation. */
  contactPhone: z.string().regex(/^\+?\d{10,15}$/).optional(),
});

export const leadDriverActionSchema = z.object({
  action: z.enum(['viewed', 'accept', 'reject']),
  reason: z.string().max(300).optional(),
});

// --- Calls ---

export const callInitiateSchema = z.object({ leadId: z.string().length(24) });

export const callOutcomeSchema = z.object({
  status: z.enum(['connected', 'no_answer', 'failed', 'completed', 'cancelled']),
  durationSeconds: z.number().int().nonnegative().max(4 * 3600).optional(),
});

// --- Wallet ---

export const rechargeCreateSchema = z.object({ amountPaise: z.number().int().positive() });

export const rechargeVerifySchema = z.object({
  orderId: z.string().max(120),
  paymentId: z.string().max(120),
  signature: z.string().max(256),
});

export const walletAdjustSchema = z.object({
  kind: z.enum(['balance', 'free_credits', 'promo_credits']),
  /** Paise for balance, count for credits; signed. */
  amount: z.number().int().refine((v) => v !== 0, 'Adjustment cannot be zero'),
  reason: z.string().min(3).max(500),
});

// --- Pricing rules ---

export const pricingRuleInputSchema = z.object({
  name: z.string().min(2).max(120),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(10_000).default(0),
  match: z
    .object({
      vehicleType: z.string().max(30).optional(),
      city: z.string().max(80).optional(),
      zoneId: z.string().length(24).optional(),
      driverCategory: z.string().max(40).optional(),
      hourFrom: z.number().int().min(0).max(23).optional(),
      hourTo: z.number().int().min(0).max(24).optional(),
    })
    .default({}),
  pricePaise: z.number().int().min(0),
});

// --- Trips / ratings / support ---

export const tripActionSchema = z.object({
  action: z.enum(['en_route', 'arrived', 'start', 'complete', 'cancel']),
});

export const ratingCreateSchema = z.object({
  stars: z.number().int().min(1).max(5),
  review: z.string().max(1000).optional(),
});

export const supportCreateSchema = z.object({
  category: z.enum(['lead', 'call', 'billing', 'wallet', 'document', 'account', 'safety', 'location', 'payment', 'driver', 'general']),
  subject: z.string().min(3).max(200),
  body: z.string().min(3).max(4000),
});

export const supportReplySchema = z.object({ body: z.string().min(1).max(4000) });

// --- Settings ---

export const settingsPatchSchema = z.record(z.string(), z.unknown());

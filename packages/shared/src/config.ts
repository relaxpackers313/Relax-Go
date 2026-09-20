import { z } from 'zod';

/**
 * The platform-settings schema: every business-configurable value on Relax Go, with its default.
 * The API stores ONE versioned document validated by this schema; admin edits are audited per path.
 * Service code must read these through the settings service — a business number written as a
 * literal anywhere else is a bug (CLAUDE.md rule 3).
 *
 * All money is integer paise. All distances are km. All durations carry their unit in the name.
 */

export const vehicleTypeSchema = z.object({
  key: z.string().min(1).max(30).regex(/^[a-z0-9_]+$/),
  label: z.string().min(1).max(60),
  active: z.boolean().default(true),
});

export const requiredDocumentSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
  label: z.string().min(1).max(80),
  required: z.boolean().default(true),
  /** When true, an expiry date must be captured and expiry blocks eligibility per driver rules. */
  expiryTracked: z.boolean().default(false),
  /** Whether an expired/rejected state of this document removes the driver from discovery. */
  blocksEligibilityWhenInvalid: z.boolean().default(true),
});

export const platformSettingsSchema = z.object({
  brand: z.object({
    productName: z.string().default('Relax Go'),
    company: z.string().default('ChefoTech'),
    operator: z.string().default('Relax Group'),
    tagline: z.string().default('Nearby drivers, one tap away.'),
    supportPhone: z.string().default('+91 97770 12315'),
    supportAltPhone: z.string().default('+91 96920 12315'),
    supportWhatsapp: z.string().default('+91 97770 12315'),
    supportEmail: z.string().default('bookrelaxpackers@gmail.com'),
    operatorWebsite: z.string().default('https://packers.relaxgroup.in'),
    operatorGstin: z.string().default('21BUQPN8897R1Z8'),
    headOfficeAddress: z
      .string()
      .default('Khata No. 313/143, Plot No. 945/1260, Tangarhuda, Satinagar, PO Markat Nagar, PS Bidanasi, Cuttack, Odisha 753014'),
    city: z.string().default('Cuttack'),
    region: z.string().default('Odisha'),
    country: z.string().default('IN'),
  }),

  auth: z.object({
    /** How drivers sign in: phone+password (no external dependency) or Firebase phone OTP. */
    driverAuthMode: z.enum(['phone_password', 'firebase']).default('phone_password'),
  }),

  vehicleTypes: z.array(vehicleTypeSchema).default([
    { key: 'bike', label: 'Bike', active: true },
    { key: 'auto', label: 'Auto', active: true },
    { key: 'car', label: 'Car', active: true },
  ]),

  discovery: z.object({
    /** Radius the customer request may ask for, clamped into [min, max]. */
    minRadiusKm: z.number().positive().default(1),
    defaultRadiusKm: z.number().positive().default(10),
    /** Hard cap — a driver beyond this NEVER appears (spec: default 50, configurable). */
    maxRadiusKm: z.number().positive().default(50),
    /** Maximum drivers returned in one discovery response. */
    maxDrivers: z.number().int().positive().max(200).default(50),
    sortMode: z.enum(['distance', 'rating', 'distance_then_rating']).default('distance'),
    /** 'straight_line' filters and ranks by geodesic distance; 'road' additionally resolves road distance for the returned set. */
    distanceMode: z.enum(['straight_line', 'road']).default('straight_line'),
    /** A location older than this is 'stale' and excluded from discovery. */
    locationFreshnessSeconds: z.number().int().positive().default(120),
  }),

  location: z.object({
    foregroundIntervalSeconds: z.number().int().positive().default(5),
    backgroundIntervalSeconds: z.number().int().positive().default(15),
    /** Reject points reporting worse accuracy than this (meters). */
    maxAccuracyMeters: z.number().positive().default(200),
    /** Reject points implying speed above this (km/h) vs. previous point. */
    maxPlausibleSpeedKmh: z.number().positive().default(180),
    /** Persist at most one history sample per driver per this window. */
    historySampleSeconds: z.number().int().positive().default(60),
    historyRetentionDays: z.number().int().positive().default(30),
    /** Customer map update throttle per driver; 0 forwards every accepted update. */
    realtimeThrottleSeconds: z.number().int().nonnegative().default(3),
  }),

  leads: z.object({
    expiryMinutes: z.number().int().positive().default(30),
    maxActivePerCustomer: z.number().int().positive().default(5),
    /** A second lead from the same session to the same driver inside this window is rejected as duplicate. */
    duplicateWindowMinutes: z.number().int().nonnegative().default(10),
    destinationRequired: z.boolean().default(false),
  }),

  calls: z.object({
    /** One-time free credits granted on driver approval. */
    freeCreditsOnApproval: z.number().int().nonnegative().default(50),
    /** Recurring free-call allowances; 0 disables that window. */
    freeCallsPerDay: z.number().int().nonnegative().default(10),
    freeCallsPerWeek: z.number().int().nonnegative().default(0),
    freeCallsPerMonth: z.number().int().nonnegative().default(0),
    /** Fallback price when no PricingRule matches (paise). */
    basePricePaise: z.number().int().nonnegative().default(200),
    /** true → charge only calls that connect; false → charge on initiation. */
    chargeOnlyConnected: z.boolean().default(false),
    /** Repeat call to the same lead inside this window is not charged again. */
    duplicateCallWindowMinutes: z.number().int().nonnegative().default(15),
    cooldownSeconds: z.number().int().nonnegative().default(0),
    /** Driver must hold at least this balance (paise) to receive chargeable leads once free credits are gone. */
    minWalletBalancePaise: z.number().int().nonnegative().default(0),
    /** Timezone offset (minutes) for daily/weekly/monthly allowance windows; 330 = IST. */
    allowanceTzOffsetMinutes: z.number().int().min(-720).max(840).default(330),
  }),

  wallet: z.object({
    minRechargePaise: z.number().int().positive().default(5000), // ₹50
    maxRechargePaise: z.number().int().positive().default(1000000), // ₹10,000
    allowNegativeBalance: z.boolean().default(false),
    /** Only used when allowNegativeBalance is true. */
    creditLimitPaise: z.number().int().nonnegative().default(0),
    currency: z.literal('INR').default('INR'),
    paymentGateway: z.enum(['none', 'razorpay']).default('none'),
    lowBalanceThresholdPaise: z.number().int().nonnegative().default(2000), // ₹20 → notify
  }),

  maps: z.object({
    provider: z.enum(['osm', 'google', 'mapbox']).default('osm'),
    /** Either a raster tile TEMPLATE (contains {z}) or a full MapLibre style URL. */
    tileUrl: z.string().default('https://tiles.openfreemap.org/styles/bright'),
    tileAttribution: z.string().default('© OpenStreetMap contributors © OpenFreeMap'),
    geocodingProvider: z.enum(['nominatim', 'google', 'mapbox']).default('nominatim'),
    nominatimUrl: z.string().default('https://nominatim.openstreetmap.org'),
    routingProvider: z.enum(['osrm', 'google', 'mapbox']).default('osrm'),
    osrmUrl: z.string().default('https://router.project-osrm.org'),
    /** Provider API keys are SECRETS: stored sealed server-side via the settings-secrets store, never in this document. */
  }),

  driverOnboarding: z.object({
    requiredDocuments: z.array(requiredDocumentSchema).default([
      { key: 'aadhaar', label: 'Aadhaar card', required: true, expiryTracked: false, blocksEligibilityWhenInvalid: true },
      { key: 'driving_licence', label: 'Driving licence', required: true, expiryTracked: true, blocksEligibilityWhenInvalid: true },
      { key: 'vehicle_rc', label: 'Vehicle registration certificate (RC)', required: true, expiryTracked: false, blocksEligibilityWhenInvalid: true },
      { key: 'insurance', label: 'Vehicle insurance', required: true, expiryTracked: true, blocksEligibilityWhenInvalid: true },
      { key: 'pan', label: 'PAN card', required: false, expiryTracked: false, blocksEligibilityWhenInvalid: false },
      { key: 'profile_photo', label: 'Profile photo', required: true, expiryTracked: false, blocksEligibilityWhenInvalid: false },
    ]),
    requireEmergencyContact: z.boolean().default(true),
    requireBankDetails: z.boolean().default(false),
    documentExpiryWarningDays: z.number().int().positive().default(30),
  }),

  ratings: z.object({
    enabled: z.boolean().default(true),
    /** Average below this flags the driver for admin review (never auto-suspends). */
    reviewThreshold: z.number().min(1).max(5).default(3),
    minRatingsBeforeFlag: z.number().int().positive().default(5),
  }),

  safety: z.object({
    sosEnabled: z.boolean().default(true),
    /** Numbers shown on the SOS screen. 112 is India's national emergency number (dialed by the user, not an "integration"). */
    sosNumbers: z.array(z.string()).default(['112']),
    tripSharingEnabled: z.boolean().default(true),
    maxEmergencyContacts: z.number().int().positive().default(3),
  }),

  notifications: z.object({
    pushEnabled: z.boolean().default(true),
    emailEnabled: z.boolean().default(true),
    smsEnabled: z.boolean().default(false),
  }),

  features: z.object({
    driverList: z.boolean().default(true),
    liveTracking: z.boolean().default(true),
    callCharging: z.boolean().default(true),
    wallet: z.boolean().default(true),
    trips: z.boolean().default(true),
    ratings: z.boolean().default(true),
    sos: z.boolean().default(true),
    tripSharing: z.boolean().default(true),
    scheduledRequests: z.boolean().default(false),
    referrals: z.boolean().default(false),
  }),

  security: z.object({
    otpRequestsPerHour: z.number().int().positive().default(5),
    leadCreatesPerHour: z.number().int().positive().default(20),
    callInitiationsPerHour: z.number().int().positive().default(30),
    locationUpdatesPerMinute: z.number().int().positive().default(30),
    apiRequestsPerMinute: z.number().int().positive().default(300),
  }),
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

/** The complete default configuration — parse of the empty object fills every default. */
export const defaultPlatformSettings = (): PlatformSettings =>
  platformSettingsSchema.parse({
    brand: {}, auth: {}, discovery: {}, location: {}, leads: {}, calls: {}, wallet: {}, maps: {},
    driverOnboarding: {}, ratings: {}, safety: {}, notifications: {}, features: {}, security: {},
  });

/** Deep-merge a partial patch over current settings and re-validate. Arrays are replaced, not merged. */
export function mergeSettings(current: PlatformSettings, patch: unknown): PlatformSettings {
  const merge = (base: unknown, over: unknown): unknown => {
    if (Array.isArray(over)) return over;
    if (over && typeof over === 'object' && base && typeof base === 'object' && !Array.isArray(base)) {
      const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return over === undefined ? base : over;
  };
  return platformSettingsSchema.parse(merge(current, patch));
}

/** Flatten to dotted paths for change-diffing in the audit log. */
export function flattenSettings(value: unknown, prefix = ''): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(out, flattenSettings(v, prefix ? `${prefix}.${k}` : k));
    }
    return out;
  }
  return { [prefix]: Array.isArray(value) ? JSON.stringify(value) : value };
}

export function diffSettings(before: PlatformSettings, after: PlatformSettings): { path: string; from: unknown; to: unknown }[] {
  const a = flattenSettings(before);
  const b = flattenSettings(after);
  const paths = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: { path: string; from: unknown; to: unknown }[] = [];
  for (const p of paths) if (a[p] !== b[p]) changes.push({ path: p, from: a[p], to: b[p] });
  return changes;
}

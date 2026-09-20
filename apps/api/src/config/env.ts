import 'dotenv/config';
import dns from 'node:dns';
import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4100),
  API_BASE_PATH: z.string().default('/api/v1'),
  MONGODB_URI: z.string().min(1),
  DNS_SERVERS: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: boolish,

  /** Comma-separated list of browser origins allowed to call the API (admin panel domains). */
  ADMIN_ORIGIN: z.string().default('http://localhost:3100'),
  /** Optional: also allow Vercel preview deploys of this project, e.g. "relaxgo-admin". */
  VERCEL_PROJECT_NAME: z.string().optional(),
  /** Seeds the first superadmin at boot when the collection is empty. */
  ADMIN_BOOTSTRAP_EMAIL: z.string().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),

  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),

  BREVO_API_KEY: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default('Relax Go'),
  EMAIL_FROM_ADDRESS: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  /** Server-side Google Maps Platform key (Places, Routes, Geocoding). Never sent to clients. */
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Exact browser origins allowed by CORS (ADMIN_ORIGIN may list several, comma-separated). */
export const allowedOrigins: string[] = env.ADMIN_ORIGIN.split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

/**
 * Shared CORS origin check. The mobile apps send no Origin header at all (native fetch), so
 * `undefined` must pass; browsers get an allow-list, optionally including this project's
 * Vercel preview deploys so a preview URL can talk to the same API.
 */
export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  const clean = origin.replace(/\/$/, '');
  if (allowedOrigins.includes(clean)) return true;
  if (env.VERCEL_PROJECT_NAME) {
    const preview = new RegExp(`^https://${env.VERCEL_PROJECT_NAME}-[a-z0-9-]+\\.vercel\\.app$`, 'i');
    if (preview.test(clean)) return true;
  }
  return false;
}

if (env.DNS_SERVERS) dns.setServers(env.DNS_SERVERS.split(',').map((s) => s.trim()));

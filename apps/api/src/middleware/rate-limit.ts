import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';
import { getSettings } from '../modules/settings/settings.service';

/**
 * Rate limits (spec §52) read their ceilings from platform settings LIVE (settings are
 * memory-cached), so the admin's security section actually governs behaviour — no dead config.
 * Tests bypass with a huge ceiling.
 */
const make = (windowMs: number, pick: (s: Awaited<ReturnType<typeof getSettings>>) => number, fallback: number) =>
  rateLimit({
    windowMs,
    limit: async () => {
      if (isTest) return 100_000;
      try {
        return pick(await getSettings());
      } catch {
        return fallback;
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests, please slow down' } },
  });

const staticLimit = (windowMs: number, limit: number) =>
  rateLimit({
    windowMs,
    limit: isTest ? 100_000 : limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests, please slow down' } },
  });

/** Sign-in attempts (admin + driver token exchange). */
export const authRateLimit = make(60 * 60 * 1000, (s) => s.security.otpRequestsPerHour * 4, 20);
/** Anonymous session creation. */
export const sessionRateLimit = staticLimit(60 * 60 * 1000, 30);
/** Customer lead creation. */
export const leadRateLimit = make(60 * 60 * 1000, (s) => s.security.leadCreatesPerHour, 20);
/** Driver call initiation. */
export const callRateLimit = make(60 * 60 * 1000, (s) => s.security.callInitiationsPerHour, 30);
/** Driver GPS batches. */
export const locationRateLimit = make(60 * 1000, (s) => s.security.locationUpdatesPerMinute, 30);
/** Global per-IP ceiling. */
export const apiRateLimit = make(60 * 1000, (s) => s.security.apiRequestsPerMinute, 300);

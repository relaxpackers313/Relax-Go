import { Types } from 'mongoose';
import { PricingRule, type PricingRuleDoc } from '../../models/wallet.model';
import { getSettings } from '../settings/settings.service';

export interface PriceContext {
  vehicleType?: string;
  city?: string;
  zoneId?: string;
  driverCategory?: string;
  at?: Date;
}

/** Local hour in the configured allowance timezone. */
export function localHour(at: Date, tzOffsetMinutes: number): number {
  return new Date(at.getTime() + tzOffsetMinutes * 60_000).getUTCHours();
}

function hourMatches(hour: number, from?: number | null, to?: number | null): boolean {
  if (from == null || to == null) return true;
  // Window may wrap midnight (e.g. 22 → 6).
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

function ruleMatches(rule: PricingRuleDoc, ctx: PriceContext, hour: number): boolean {
  const m = rule.match ?? {};
  if (m.vehicleType && m.vehicleType !== ctx.vehicleType) return false;
  if (m.city && m.city.toLowerCase() !== ctx.city?.toLowerCase()) return false;
  if (m.zoneId && String(m.zoneId) !== ctx.zoneId) return false;
  if (m.driverCategory && m.driverCategory !== ctx.driverCategory) return false;
  if (!hourMatches(hour, m.hourFrom, m.hourTo)) return false;
  return true;
}

/**
 * Resolve the call price (spec §26): highest-priority active rule whose every defined
 * criterion matches wins; undefined criteria are wildcards; fallback is the config base price.
 */
export async function resolveCallPrice(ctx: PriceContext): Promise<{ pricePaise: number; ruleId?: string; ruleName?: string }> {
  const settings = await getSettings();
  const at = ctx.at ?? new Date();
  const hour = localHour(at, settings.calls.allowanceTzOffsetMinutes);
  const rules = await PricingRule.find({ active: true }).sort({ priority: -1, createdAt: -1 }).limit(500);
  for (const rule of rules) {
    if (ruleMatches(rule as PricingRuleDoc, ctx, hour)) {
      return { pricePaise: rule.pricePaise, ruleId: String(rule._id), ruleName: rule.name };
    }
  }
  return { pricePaise: settings.calls.basePricePaise };
}

/** Start of the current allowance period (day/week/month) in the configured timezone. Weeks start Monday. */
export function periodStart(period: 'day' | 'week' | 'month', tzOffsetMinutes: number, now = new Date()): Date {
  const shifted = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  let startUtcMs: number;
  if (period === 'day') startUtcMs = Date.UTC(y, m, d);
  else if (period === 'month') startUtcMs = Date.UTC(y, m, 1);
  else {
    const dow = (shifted.getUTCDay() + 6) % 7;
    startUtcMs = Date.UTC(y, m, d - dow);
  }
  return new Date(startUtcMs - tzOffsetMinutes * 60_000);
}

export const toObjectId = (id: string) => new Types.ObjectId(id);

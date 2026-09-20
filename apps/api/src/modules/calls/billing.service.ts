import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { formatMoney } from '@relaxgo/shared';
import { Call } from '../../models/lead.model';
import { Wallet, WalletTransaction } from '../../models/wallet.model';
import { getSettings } from '../settings/settings.service';
import { periodStart, resolveCallPrice, type PriceContext } from '../pricing/pricing.service';
import { ApiError } from '../../lib/errors';
import { trusted } from '../../lib/mongo';

export interface BillingDecision {
  classification: 'free' | 'promo' | 'paid' | 'unbilled';
  amountPaise: number;
  /** Which pool a 'free' call came from. */
  freeSource?: 'daily' | 'weekly' | 'monthly' | 'credits';
  pricingRuleId?: string;
  reasonShown: string;
}

async function allowanceUsed(driverId: string, period: 'day' | 'week' | 'month', tz: number): Promise<number> {
  return Call.countDocuments({
    driverId: new Types.ObjectId(driverId),
    initiatedAt: trusted({ $gte: periodStart(period, tz) }),
    'billing.classification': 'free',
    'billing.freeSource': period === 'day' ? 'daily' : period === 'week' ? 'weekly' : 'monthly',
  });
}

/**
 * Decide how a call will be billed (spec §23 checklist steps 4–6), in configured priority:
 * recurring allowances (daily → weekly → monthly) → free-credit balance → promo credits → paid.
 * Pure decision; executeBilling applies it atomically.
 */
export async function decideBilling(driverId: string, priceCtx: PriceContext): Promise<BillingDecision> {
  const settings = await getSettings();
  const c = settings.calls;
  if (!settings.features.callCharging) {
    return { classification: 'unbilled', amountPaise: 0, reasonShown: 'Calls are free right now' };
  }
  const tz = c.allowanceTzOffsetMinutes;

  if (c.freeCallsPerDay > 0 && (await allowanceUsed(driverId, 'day', tz)) < c.freeCallsPerDay) {
    return { classification: 'free', amountPaise: 0, freeSource: 'daily', reasonShown: 'Free call (daily allowance)' };
  }
  if (c.freeCallsPerWeek > 0 && (await allowanceUsed(driverId, 'week', tz)) < c.freeCallsPerWeek) {
    return { classification: 'free', amountPaise: 0, freeSource: 'weekly', reasonShown: 'Free call (weekly allowance)' };
  }
  if (c.freeCallsPerMonth > 0 && (await allowanceUsed(driverId, 'month', tz)) < c.freeCallsPerMonth) {
    return { classification: 'free', amountPaise: 0, freeSource: 'monthly', reasonShown: 'Free call (monthly allowance)' };
  }

  const wallet = await Wallet.findOne({ driverId });
  if (wallet && wallet.freeCredits > 0) {
    return { classification: 'free', amountPaise: 0, freeSource: 'credits', reasonShown: `Free credit used (${wallet.freeCredits - 1} left)` };
  }
  if (wallet && wallet.promoCredits > 0) {
    return { classification: 'promo', amountPaise: 0, reasonShown: `Promo credit used (${wallet.promoCredits - 1} left)` };
  }

  const price = await resolveCallPrice(priceCtx);
  if (price.pricePaise === 0) {
    return { classification: 'unbilled', amountPaise: 0, pricingRuleId: price.ruleId, reasonShown: 'No charge for this call' };
  }
  const balance = wallet?.balancePaise ?? 0;
  if (balance - price.pricePaise < c.minWalletBalancePaise) {
    // The exact product message from the spec.
    throw new ApiError(402, 'no_credits', 'You have no call credits available. Add money to your wallet to continue.');
  }
  return {
    classification: 'paid',
    amountPaise: price.pricePaise,
    pricingRuleId: price.ruleId,
    reasonShown: `${formatMoney(price.pricePaise)} charged from wallet`,
  };
}

/**
 * Apply a billing decision atomically: guarded wallet update (never below the floor, so two
 * simultaneous calls can't double-spend) plus the ledger row, inside the caller's transaction.
 */
export async function executeBilling(
  input: { driverId: string; callId: Types.ObjectId; leadId?: Types.ObjectId; decision: BillingDecision },
  session: ClientSession,
): Promise<{ walletTransactionId?: Types.ObjectId }> {
  const { decision } = input;
  if (decision.classification === 'unbilled' || (decision.classification === 'free' && decision.freeSource !== 'credits')) {
    return {};
  }
  const settings = await getSettings();
  const driverId = new Types.ObjectId(input.driverId);

  let update: Record<string, unknown>;
  let guard: Record<string, unknown>;
  let kind: 'free_credit_consume' | 'promo_credit_consume' | 'call_charge';
  let credits = 0;
  let amountPaise = 0;

  if (decision.classification === 'free') {
    guard = { driverId, freeCredits: trusted({ $gte: 1 }) };
    update = { $inc: { freeCredits: -1 } };
    kind = 'free_credit_consume';
    credits = -1;
  } else if (decision.classification === 'promo') {
    guard = { driverId, promoCredits: trusted({ $gte: 1 }) };
    update = { $inc: { promoCredits: -1 } };
    kind = 'promo_credit_consume';
    credits = -1;
  } else {
    const floor = settings.wallet.allowNegativeBalance ? -settings.wallet.creditLimitPaise : settings.calls.minWalletBalancePaise;
    guard = { driverId, balancePaise: trusted({ $gte: decision.amountPaise + floor }) };
    update = { $inc: { balancePaise: -decision.amountPaise } };
    kind = 'call_charge';
    amountPaise = -decision.amountPaise;
  }

  const wallet = await Wallet.findOneAndUpdate(guard, update, { returnDocument: 'after', session });
  if (!wallet) {
    throw new ApiError(402, 'no_credits', 'You have no call credits available. Add money to your wallet to continue.');
  }
  const [tx] = await WalletTransaction.create(
    [
      {
        walletId: wallet._id,
        driverId,
        kind,
        amountPaise,
        credits,
        balanceAfterPaise: wallet.balancePaise,
        freeCreditsAfter: wallet.freeCredits,
        promoCreditsAfter: wallet.promoCredits,
        ref: { callId: input.callId, leadId: input.leadId },
        note: decision.reasonShown,
      },
    ],
    { session },
  );
  return { walletTransactionId: tx!._id };
}

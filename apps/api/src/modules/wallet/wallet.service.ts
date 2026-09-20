import { Types } from 'mongoose';
import { formatMoney } from '@relaxgo/shared';
import { Payment, Wallet, WalletTransaction } from '../../models/wallet.model';
import { Driver } from '../../models/driver.model';
import { Notification } from '../../models/ops.model';
import { getSettings } from '../settings/settings.service';
import { getGateway } from '../../services/payments/gateway';
import { sendEmail } from '../../services/email';
import { ApiError } from '../../lib/errors';
import { audit, type Actor } from '../../lib/audit';
import { trusted, withTransaction } from '../../lib/mongo';
import { logger } from '../../lib/logger';

export async function getWallet(driverId: string) {
  let wallet = await Wallet.findOne({ driverId });
  wallet ??= await Wallet.create({ driverId });
  return wallet;
}

export async function listTransactions(driverId: string, limit = 50) {
  return WalletTransaction.find({ driverId: new Types.ObjectId(driverId) }).sort({ createdAt: -1 }).limit(Math.min(limit, 200));
}

/** Step 1 of recharge (spec §25): create a gateway order; nothing is credited here. */
export async function createRecharge(driverId: string, amountPaise: number) {
  const settings = await getSettings();
  if (!settings.features.wallet) throw ApiError.conflict('Wallet is not enabled');
  if (amountPaise < settings.wallet.minRechargePaise) {
    throw ApiError.unprocessable(`Minimum recharge is ${formatMoney(settings.wallet.minRechargePaise)}`, { amountPaise: 'Too low' });
  }
  if (amountPaise > settings.wallet.maxRechargePaise) {
    throw ApiError.unprocessable(`Maximum recharge is ${formatMoney(settings.wallet.maxRechargePaise)}`, { amountPaise: 'Too high' });
  }
  const gateway = await getGateway();
  const receipt = `rg_${driverId.slice(-8)}_${Date.now()}`;
  const order = await gateway.createOrder({ amountPaise, receipt });
  const payment = await Payment.create({
    driverId,
    gateway: gateway.name,
    gatewayOrderId: order.gatewayOrderId,
    amountPaise,
    status: 'created',
  });
  return { paymentId: String(payment._id), order };
}

/**
 * Credit the wallet for a VERIFIED payment. Idempotent two ways: the Payment status guard and
 * the unique ledger idempotencyKey — a delayed webhook after a client verify (or a retried
 * webhook) can never credit twice.
 */
async function creditVerifiedPayment(gatewayOrderId: string, gatewayPaymentId: string, via: 'client_verify' | 'webhook') {
  const payment = await Payment.findOne({ gatewayOrderId });
  if (!payment) throw ApiError.notFound('Payment order not found');
  if (payment.status === 'verified') return payment; // already credited
  if (payment.status === 'refunded' || payment.status === 'failed') {
    throw ApiError.conflict(`This payment is ${payment.status}`);
  }

  await withTransaction(async (session) => {
    const fresh = await Payment.findOneAndUpdate(
      { _id: payment._id, status: trusted({ $in: ['created', 'pending'] }) },
      {
        $set: {
          status: 'verified',
          gatewayPaymentId,
          verifiedAt: new Date(),
          ...(via === 'webhook' ? { webhookReceivedAt: new Date() } : {}),
        },
      },
      { returnDocument: 'after', session },
    );
    if (!fresh) return; // another writer won the race
    const wallet = await Wallet.findOneAndUpdate(
      { driverId: payment.driverId },
      { $inc: { balancePaise: payment.amountPaise } },
      { returnDocument: 'after', upsert: true, session },
    );
    await WalletTransaction.create(
      [
        {
          walletId: wallet!._id,
          driverId: payment.driverId,
          kind: 'recharge',
          amountPaise: payment.amountPaise,
          balanceAfterPaise: wallet!.balancePaise,
          freeCreditsAfter: wallet!.freeCredits,
          promoCreditsAfter: wallet!.promoCredits,
          ref: { paymentId: payment._id },
          note: `Wallet recharge via ${payment.gateway}`,
          idempotencyKey: `recharge:${payment._id}`,
        },
      ],
      { session },
    );
  });

  const done = (await Payment.findById(payment._id))!;
  await Notification.create({
    audience: { kind: 'driver', id: String(payment.driverId) },
    channel: 'in_app',
    type: 'wallet.recharged',
    title: 'Wallet recharged',
    body: `${formatMoney(payment.amountPaise)} added to your wallet.`,
    data: { paymentId: String(payment._id) },
  });
  const driver = await Driver.findById(payment.driverId);
  if (driver?.email) {
    void sendEmail({
      to: [{ email: driver.email, name: driver.fullName ?? undefined }],
      subject: `Relax Go wallet receipt — ${formatMoney(payment.amountPaise)}`,
      html: `<p>Hi ${driver.fullName ?? 'driver'},</p><p>Your Relax Go wallet was recharged with <b>${formatMoney(payment.amountPaise)}</b> (order ${gatewayOrderId}).</p><p>— Relax Go, a ChefoTech product operated by Relax Group</p>`,
    }).catch((err) => logger.warn({ err }, 'receipt email failed'));
  }
  return done;
}

/** Step 2a: client returns from checkout with a signature — verify server-side, then credit. */
export async function verifyRecharge(driverId: string, input: { orderId: string; paymentId: string; signature: string }) {
  const gateway = await getGateway();
  if (!gateway.verifyPayment(input)) {
    await Payment.updateOne({ gatewayOrderId: input.orderId, status: 'created' }, { $set: { status: 'failed', failureReason: 'signature mismatch' } });
    throw ApiError.unauthorized('Payment verification failed');
  }
  const payment = await Payment.findOne({ gatewayOrderId: input.orderId });
  if (!payment || String(payment.driverId) !== driverId) throw ApiError.notFound('Payment order not found');
  const done = await creditVerifiedPayment(input.orderId, input.paymentId, 'client_verify');
  const wallet = await getWallet(driverId);
  return { status: done.status, wallet: { balancePaise: wallet.balancePaise, freeCredits: wallet.freeCredits, promoCredits: wallet.promoCredits } };
}

/** Step 2b: gateway webhook — the authoritative confirmation even if the app died mid-checkout. */
export async function handleWebhook(rawBody: string, signature: string) {
  const gateway = await getGateway();
  const result = gateway.verifyWebhook(rawBody, signature);
  if (!result.valid) throw ApiError.unauthorized('Invalid webhook signature');
  if (result.event === 'payment.captured' && result.orderId && result.paymentId) {
    await creditVerifiedPayment(result.orderId, result.paymentId, 'webhook');
  }
  return { received: true };
}

/** Admin adjustment (spec §29): signed delta on balance or credit pools, always with a reason, ledgered and audited. */
export async function adminAdjust(
  actor: Actor,
  driverId: string,
  input: { kind: 'balance' | 'free_credits' | 'promo_credits'; amount: number; reason: string },
) {
  const settings = await getSettings();
  const driver = await Driver.findById(driverId);
  if (!driver) throw ApiError.notFound('Driver not found');

  return withTransaction(async (session) => {
    const inc =
      input.kind === 'balance'
        ? { balancePaise: input.amount }
        : input.kind === 'free_credits'
          ? { freeCredits: input.amount }
          : { promoCredits: input.amount };
    const wallet = await Wallet.findOneAndUpdate({ driverId }, { $inc: inc }, { returnDocument: 'after', upsert: true, session });
    const floor = settings.wallet.allowNegativeBalance ? -settings.wallet.creditLimitPaise : 0;
    if (wallet!.balancePaise < floor || wallet!.freeCredits < 0 || wallet!.promoCredits < 0) {
      throw ApiError.unprocessable('Adjustment would make the wallet negative');
    }
    const kind = input.kind === 'balance' ? 'admin_adjustment' : input.amount > 0 ? (input.kind === 'free_credits' ? 'free_credit_grant' : 'promo_credit_grant') : input.kind === 'free_credits' ? 'free_credit_consume' : 'promo_credit_consume';
    await WalletTransaction.create(
      [
        {
          walletId: wallet!._id,
          driverId,
          kind,
          amountPaise: input.kind === 'balance' ? input.amount : 0,
          credits: input.kind === 'balance' ? 0 : input.amount,
          balanceAfterPaise: wallet!.balancePaise,
          freeCreditsAfter: wallet!.freeCredits,
          promoCreditsAfter: wallet!.promoCredits,
          ref: { adminId: actor.id ? new Types.ObjectId(actor.id) : undefined },
          note: input.reason,
        },
      ],
      { session },
    );
    await audit(
      {
        actor,
        action: 'wallet.adjust',
        target: { kind: 'driver', id: driverId },
        after: { kind: input.kind, amount: input.amount },
        reason: input.reason,
      },
      session,
    );
    return wallet!;
  });
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { ApiError } from '../../lib/errors';
import type { PaymentGateway } from './gateway';

const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/** Razorpay adapter: order creation over REST, HMAC-SHA256 signature checks for callback and webhook. */
export function razorpayGateway(): PaymentGateway {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw ApiError.conflict('Payment gateway is not configured. Please contact support.');
  const basic = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  return {
    name: 'razorpay',
    async createOrder({ amountPaise, receipt }) {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
        body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
      });
      if (!res.ok) {
        throw ApiError.conflict(`Payment order could not be created (${res.status}). Try again shortly.`);
      }
      const order = (await res.json()) as { id: string };
      return { gatewayOrderId: order.id, amountPaise, currency: 'INR', clientData: { keyId, orderId: order.id } };
    },
    verifyPayment({ orderId, paymentId, signature }) {
      const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
      return safeEqual(expected, signature);
    },
    verifyWebhook(rawBody, signature) {
      const secret = env.RAZORPAY_WEBHOOK_SECRET ?? keySecret;
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      if (!safeEqual(expected, signature)) return { valid: false };
      try {
        const payload = JSON.parse(rawBody) as {
          event?: string;
          payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
        };
        const entity = payload.payload?.payment?.entity;
        return { valid: true, event: payload.event, paymentId: entity?.id, orderId: entity?.order_id };
      } catch {
        return { valid: false };
      }
    },
  };
}

import { ApiError } from '../../lib/errors';
import { getSettings } from '../../modules/settings/settings.service';

/**
 * Payment-gateway abstraction (spec §25): the wallet only credits after a server-verified
 * confirmation. Which gateway is live comes from platform settings; keys come from env.
 */
export interface CreatedOrder {
  gatewayOrderId: string;
  amountPaise: number;
  currency: string;
  /** Values the mobile client needs to open the gateway's checkout (public key id etc.). */
  clientData: Record<string, string>;
}

export interface PaymentGateway {
  readonly name: string;
  createOrder(input: { amountPaise: number; receipt: string }): Promise<CreatedOrder>;
  /** Client-callback verification (order + payment + signature). */
  verifyPayment(input: { orderId: string; paymentId: string; signature: string }): boolean;
  /** Webhook verification over the raw body. Returns the affected payment when valid. */
  verifyWebhook(rawBody: string, signature: string): { valid: boolean; orderId?: string; paymentId?: string; event?: string };
}

let testGateway: PaymentGateway | null = null;

export async function getGateway(): Promise<PaymentGateway> {
  if (testGateway) return testGateway;
  const settings = await getSettings();
  if (settings.wallet.paymentGateway === 'razorpay') {
    const { razorpayGateway } = await import('./razorpay');
    return razorpayGateway();
  }
  throw ApiError.conflict('Online recharge is not enabled yet. Please contact support.');
}

/** Test seam. */
export function _setGatewayForTests(gw: PaymentGateway | null): void {
  testGateway = gw;
}

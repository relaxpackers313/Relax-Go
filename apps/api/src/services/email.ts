import { env, isTest } from '../config/env';
import { logger } from '../lib/logger';

export interface EmailMessage {
  to: { email: string; name?: string }[];
  subject: string;
  html: string;
}

/**
 * Transactional email via Brevo (spec §47). Without a key (or in tests) it logs to the
 * console instead of sending, so flows never depend on the provider being configured.
 */
export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean }> {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM_ADDRESS || isTest) {
    logger.info({ to: message.to.map((t) => t.email), subject: message.subject }, 'email (console provider)');
    return { sent: false };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: env.EMAIL_FROM_NAME, email: env.EMAIL_FROM_ADDRESS },
      to: message.to,
      subject: message.subject,
      htmlContent: message.html,
    }),
  });
  if (!res.ok) {
    logger.error({ status: res.status, body: (await res.text()).slice(0, 300) }, 'brevo send failed');
    return { sent: false };
  }
  return { sent: true };
}

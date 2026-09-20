import { events } from '../lib/events';
import { logger } from '../lib/logger';
import { isTest } from '../config/env';

/**
 * Push delivery (spec §34–35) over Expo's push service — no SDK needed, one HTTPS call.
 * Registered once at boot: every in-app Notification row also goes out as a push when the
 * audience has a registered device token. Failures never break the business flow.
 */
export function registerPushDelivery(): void {
  events.on('notification.created', (n) => {
    void deliver(n).catch((err) => logger.warn({ err }, 'push delivery failed'));
  });
}

async function deliver(n: { audienceKind: 'driver' | 'customer'; audienceId: string; title: string; body?: string; type: string }): Promise<void> {
  if (isTest) return;
  let token: string | null | undefined;
  if (n.audienceKind === 'driver') {
    const { Driver } = await import('../models/driver.model');
    token = (await Driver.findById(n.audienceId).select('pushToken'))?.pushToken;
  } else {
    const { CustomerSession } = await import('../models/customer.model');
    token = (await CustomerSession.findById(n.audienceId).select('pushToken'))?.pushToken;
  }
  if (!token) return;
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: token, title: n.title, body: n.body ?? '', data: { type: n.type }, priority: 'high', channelId: 'default' }),
  });
  if (!res.ok) logger.warn({ status: res.status }, 'expo push rejected');
}

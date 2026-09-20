import { createServer } from 'node:http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { connectMongo } from './lib/mongo';
import { createApp } from './app';
import { bootstrapAdmin } from './modules/auth/auth.service';
import { expireOverdueLeads } from './modules/leads/leads.service';
import { initRealtime } from './realtime/gateway';
import { registerPushDelivery } from './services/push';

async function main() {
  await connectMongo();
  await bootstrapAdmin();

  const app = createApp();
  const server = createServer(app);
  initRealtime(server);
  registerPushDelivery();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, basePath: env.API_BASE_PATH, env: env.NODE_ENV }, 'relaxgo api listening');
  });

  // Lead-expiry worker: cheap indexed scan, runs every 30s.
  const expiryTimer = setInterval(() => {
    expireOverdueLeads().catch((err) => logger.error({ err }, 'lead expiry worker failed'));
  }, 30_000);

  const shutdown = () => {
    clearInterval(expiryTimer);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'fatal boot error');
  process.exit(1);
});

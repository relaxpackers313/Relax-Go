import express, { type Express } from 'express';
import { LOCAL_UPLOAD_DIR } from './services/storage';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env, isAllowedOrigin, isTest } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './lib/errors';
import { bumpUsage } from './lib/usage';
import { apiRateLimit } from './middleware/rate-limit';
import { authRouter } from './modules/auth/auth.routes';
import { settingsRouter, publicConfigRouter } from './modules/settings/settings.routes';
import { driverSelfRouter, adminDriversRouter } from './modules/drivers/drivers.routes';
import { driverLocationRouter } from './modules/locations/locations.routes';
import { discoveryRouter } from './modules/discovery/discovery.routes';
import { customerLeadsRouter, driverLeadsRouter } from './modules/leads/leads.routes';
import { driverCallsRouter, customerCallsRouter } from './modules/calls/calls.routes';
import { driverWalletRouter, paymentsWebhookRouter } from './modules/wallet/wallet.routes';
import { driverTripsRouter, customerTripsRouter, sharedTripRouter } from './modules/trips/trips.routes';
import { customerRatingsRouter } from './modules/ratings/ratings.routes';
import { supportRouter, adminSupportRouter, notificationsRouter } from './modules/support/support.routes';
import { adminOpsRouter } from './modules/admin/admin.routes';
import { geoRouter } from './modules/geo/geo.routes';
import { customerSelfRouter } from './modules/customers/customers.routes';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('Origin not allowed'))),
      credentials: true,
    }),
  );

  const base = env.API_BASE_PATH;
  // Webhooks verify an HMAC over the RAW bytes, so they mount before the JSON parser.
  app.use(`${base}/webhooks/payments`, paymentsWebhookRouter);

  app.use(`${base}/driver/uploads`, express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(apiRateLimit);
  // Cheap traffic metering for the admin dashboard (in-memory, flushed every 30s).
  app.use((req, _res, next) => {
    if (req.path !== '/health') bumpUsage('api.requests');
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'relaxgo-api' }));
  // Dev-fallback document storage; production uses Cloudinary and never serves from disk.
  if (env.NODE_ENV !== 'production') app.use('/uploads', express.static(LOCAL_UPLOAD_DIR));

  app.use(`${base}/auth`, authRouter);
  app.use(`${base}/config`, publicConfigRouter);

  app.use(`${base}/admin/settings`, settingsRouter);
  app.use(`${base}/admin/drivers`, adminDriversRouter);
  app.use(`${base}/admin/support`, adminSupportRouter);
  app.use(`${base}/admin`, adminOpsRouter);

  app.use(`${base}/driver/leads`, driverLeadsRouter);
  app.use(`${base}/driver/calls`, driverCallsRouter);
  app.use(`${base}/driver/wallet`, driverWalletRouter);
  app.use(`${base}/driver/trips`, driverTripsRouter);
  app.use(`${base}/driver`, driverSelfRouter);
  app.use(`${base}/driver`, driverLocationRouter);

  app.use(`${base}/customer/geo`, geoRouter);
  app.use(`${base}/customer`, customerSelfRouter);
  app.use(`${base}/customer/drivers`, discoveryRouter);
  app.use(`${base}/customer/leads`, customerLeadsRouter);
  app.use(`${base}/customer/calls`, customerCallsRouter);
  app.use(`${base}/customer/trips`, customerTripsRouter);
  app.use(`${base}/customer`, customerRatingsRouter);

  app.use(`${base}/support`, supportRouter);
  app.use(`${base}/notifications`, notificationsRouter);
  app.use(`${base}/shared/trips`, sharedTripRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

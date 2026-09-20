import { Router, raw } from 'express';
import { rechargeCreateSchema, rechargeVerifySchema } from '@relaxgo/shared';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth, requireApprovedDriver } from '../../middleware/auth';
import { createRecharge, getWallet, handleWebhook, listTransactions, verifyRecharge } from './wallet.service';

export const driverWalletRouter: Router = Router();
driverWalletRouter.use(requireAuth('driver'), requireApprovedDriver);

driverWalletRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const wallet = await getWallet(req.ctx!.id);
    res.json({ balancePaise: wallet.balancePaise, freeCredits: wallet.freeCredits, promoCredits: wallet.promoCredits });
  }),
);

driverWalletRouter.get(
  '/transactions',
  asyncRoute(async (req, res) => {
    res.json({ items: await listTransactions(req.ctx!.id) });
  }),
);

driverWalletRouter.post(
  '/recharge',
  asyncRoute(async (req, res) => {
    const { amountPaise } = parse(rechargeCreateSchema, req.body);
    res.status(201).json(await createRecharge(req.ctx!.id, amountPaise));
  }),
);

driverWalletRouter.post(
  '/recharge/verify',
  asyncRoute(async (req, res) => {
    const input = parse(rechargeVerifySchema, req.body);
    res.json(await verifyRecharge(req.ctx!.id, input));
  }),
);

/**
 * Gateway webhook — mounted with a RAW body parser (signature is computed over the exact
 * bytes) and no auth: the HMAC signature IS the authentication.
 */
export const paymentsWebhookRouter: Router = Router();
paymentsWebhookRouter.post(
  '/razorpay',
  raw({ type: '*/*', limit: '256kb' }),
  asyncRoute(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string') throw ApiError.unauthorized('Missing signature');
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    res.json(await handleWebhook(rawBody, signature));
  }),
);

import { Router } from 'express';
import { adminLoginSchema, customerSessionSchema, driverFirebaseLoginSchema, driverPasswordLoginSchema, driverPasswordSignupSchema } from '@relaxgo/shared';
import { asyncRoute } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { authRateLimit, sessionRateLimit } from '../../middleware/rate-limit';
import { adminLogin, createCustomerSession, driverFirebaseLogin, driverPasswordLogin, driverPasswordSignup } from './auth.service';

export const authRouter: Router = Router();

authRouter.post(
  '/admin/login',
  authRateLimit,
  asyncRoute(async (req, res) => {
    const { email, password } = parse(adminLoginSchema, req.body);
    res.json(await adminLogin(email, password));
  }),
);

authRouter.post(
  '/driver/firebase',
  authRateLimit,
  asyncRoute(async (req, res) => {
    const { idToken } = parse(driverFirebaseLoginSchema, req.body);
    res.json(await driverFirebaseLogin(idToken));
  }),
);

authRouter.post(
  '/driver/signup',
  authRateLimit,
  asyncRoute(async (req, res) => {
    const { phone, password } = parse(driverPasswordSignupSchema, req.body);
    res.status(201).json(await driverPasswordSignup(phone, password));
  }),
);

authRouter.post(
  '/driver/login',
  authRateLimit,
  asyncRoute(async (req, res) => {
    const { phone, password } = parse(driverPasswordLoginSchema, req.body);
    res.json(await driverPasswordLogin(phone, password));
  }),
);

authRouter.post(
  '/customer/session',
  sessionRateLimit,
  asyncRoute(async (req, res) => {
    const { deviceInfo } = parse(customerSessionSchema, req.body ?? {});
    res.status(201).json(await createCustomerSession(deviceInfo));
  }),
);

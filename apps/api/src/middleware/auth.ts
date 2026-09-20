import type { NextFunction, Request, Response } from 'express';
import { hasPermission, type Permission, type AdminRole } from '@relaxgo/shared';
import { ApiError } from '../lib/errors';
import { verifyAccessToken, type PrincipalKind } from '../lib/tokens';
import { AdminUser } from '../models/admin.model';
import { Driver, type DriverDoc } from '../models/driver.model';
import { CustomerSession } from '../models/customer.model';

export interface AuthContext {
  kind: PrincipalKind;
  id: string;
  admin?: { role: AdminRole; permissions: string[]; name: string; email: string };
  driver?: DriverDoc;
}

function bearer(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized();
  return header.slice(7);
}

export function requireAuth(kind: PrincipalKind) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const payload = verifyAccessToken(bearer(req));
      if (payload.kind !== kind) throw ApiError.forbidden('Wrong principal type');
      const ctx: AuthContext = { kind, id: payload.sub };

      if (kind === 'admin') {
        const admin = await AdminUser.findById(payload.sub);
        if (!admin || !admin.active) throw ApiError.unauthorized('Admin not available');
        ctx.admin = { role: admin.role as AdminRole, permissions: admin.permissions ?? [], name: admin.name, email: admin.email };
      } else if (kind === 'driver') {
        const driver = await Driver.findById(payload.sub);
        if (!driver) throw ApiError.unauthorized('Driver not found');
        if (driver.status === 'blocked') throw ApiError.forbidden('Account blocked');
        ctx.driver = driver;
      } else {
        const session = await CustomerSession.findById(payload.sub);
        if (!session) throw ApiError.unauthorized('Session not found');
        if (session.blocked) throw ApiError.forbidden('Session blocked');
        // lastSeenAt is analytics, not correctness: refresh at most once a minute and never
        // block the request on the write (this halved authenticated-request latency under load).
        if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 60_000) {
          CustomerSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } })
            .exec()
            .catch(() => undefined);
        }
      }
      req.ctx = ctx;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** For endpoints shared by drivers and customers (e.g. support). */
export function requireAnyAuth(kinds: PrincipalKind[]) {
  const handlers = new Map(kinds.map((k) => [k, requireAuth(k)]));
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = verifyAccessToken(bearer(req));
      const handler = handlers.get(payload.kind);
      if (!handler) return next(ApiError.forbidden('Wrong principal type'));
      handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const admin = req.ctx?.admin;
    if (!admin) return next(ApiError.unauthorized());
    if (!hasPermission({ role: admin.role, permissions: admin.permissions }, permission)) {
      return next(ApiError.forbidden(`Missing permission: ${permission}`));
    }
    next();
  };
}

/** Driver routes beyond auth/status require an approved driver (CLAUDE.md rule 6). */
export function requireApprovedDriver(req: Request, _res: Response, next: NextFunction) {
  const driver = req.ctx?.driver;
  if (!driver) return next(ApiError.unauthorized());
  if (driver.status !== 'approved') return next(ApiError.forbidden('Driver not approved yet'));
  next();
}

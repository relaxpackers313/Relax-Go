import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './errors';

export type PrincipalKind = 'admin' | 'driver' | 'customer';

export interface TokenPayload {
  sub: string;
  kind: PrincipalKind;
}

export function signAccessToken(payload: TokenPayload, ttlSeconds = env.JWT_ACCESS_TTL_SECONDS): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ttlSeconds });
}

/** Customer sessions are long-lived by design (anonymous identity lives in the token). */
export function signCustomerToken(sessionId: string): string {
  return jwt.sign({ sub: sessionId, kind: 'customer' } satisfies TokenPayload, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS * 12}d`,
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded === 'string' || !decoded.sub || !decoded.kind) throw new Error('malformed');
    return { sub: String(decoded.sub), kind: decoded.kind as PrincipalKind };
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
}

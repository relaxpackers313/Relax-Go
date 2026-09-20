import type { ClientSession } from 'mongoose';
import { AuditLog } from '../models/ops.model';

export interface Actor {
  kind: 'admin' | 'driver' | 'customer' | 'system';
  id?: string;
  name?: string;
}

export async function audit(
  entry: {
    actor: Actor;
    action: string;
    target?: { kind: string; id: string };
    before?: unknown;
    after?: unknown;
    reason?: string;
  },
  session?: ClientSession,
): Promise<void> {
  await AuditLog.create([entry], session ? { session, ordered: true } : { ordered: true });
}

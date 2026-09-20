import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from './logger';

// Query values from requests can never smuggle operators; server-built operator
// values must be wrapped with trusted() below (CLAUDE.md rule 10).
mongoose.set('sanitizeFilter', true);

/** Mark a server-constructed operator value ($in, $ne, $gte…) as trusted under sanitizeFilter. */
export const trusted = <T>(value: T): T => mongoose.trusted(value) as T;

export async function connectMongo(uri = env.MONGODB_URI): Promise<void> {
  await mongoose.connect(uri);
  const { host, name } = mongoose.connection;
  logger.info({ host, db: name }, 'mongodb connected');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** Run work inside a transaction (memory server runs a replica set, so tests support this too). */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

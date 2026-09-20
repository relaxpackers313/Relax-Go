import path from 'node:path';
import fs from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret-test-secret-42';
process.env.ADMIN_BOOTSTRAP_EMAIL ??= 'admin@test.local';
process.env.ADMIN_BOOTSTRAP_PASSWORD ??= 'admin-password-1';
process.env.MONGODB_URI ??= 'mongodb://placeholder:27017/placeholder'; // replaced below

let replSet: MongoMemoryReplSet | null = null;

beforeAll(async () => {
  // System C: drive is full on this machine — keep binaries AND data under the repo (see CLAUDE.md).
  const cacheDir = process.env.RELAXGO_TEST_DBPATH ?? path.resolve(__dirname, '../../../../node_modules/.cache/mongodb-memory-server');
  fs.mkdirSync(cacheDir, { recursive: true });
  process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(cacheDir, 'binaries');
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ dbPath: fs.mkdtempSync(path.join(cacheDir, 'data-')) }],
  });
  process.env.MONGODB_URI = replSet.getUri('relaxgo_test');
  const { connectMongo } = await import('../lib/mongo');
  await connectMongo(process.env.MONGODB_URI);
  await mongoose.connection.db!.admin().command({ ping: 1 });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

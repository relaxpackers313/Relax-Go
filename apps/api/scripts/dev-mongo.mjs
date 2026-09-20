// Local development MongoDB: a single-node replica set on a fixed port so the API works
// without Atlas. Data lives under node_modules/.cache and survives nothing — dev only.
// Usage: node scripts/dev-mongo.mjs   (keep it running; API connects to the printed URI)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.resolve(here, '../../../node_modules/.cache/mongodb-memory-server');
fs.mkdirSync(path.join(cacheDir, 'dev-data'), { recursive: true });
process.env.MONGOMS_DOWNLOAD_DIR ??= path.join(cacheDir, 'binaries');

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, name: 'relaxdev', storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: 4199, dbPath: fs.mkdtempSync(path.join(cacheDir, 'dev-data', 'run-')) }],
});

console.log('dev mongo ready:', replSet.getUri('relaxgo'));
console.log('Set in apps/api/.env → MONGODB_URI=mongodb://127.0.0.1:4199/relaxgo?replicaSet=relaxdev');
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// keep alive
setInterval(() => {}, 1 << 30);

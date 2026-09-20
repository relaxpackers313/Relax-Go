// One-time local helper: carries MongoDB/Firebase/Brevo/Cloudinary values from the PharmaOS
// project's .env into this project's .env (run it yourself; secrets never leave this machine).
// Usage: node scripts/copy-env-from-pharmaos.mjs [path-to-pharmaos-env]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = process.argv[2] ?? 'D:/Farmacy Management Platform/apps/api/.env';
const dstPath = path.join(here, '../apps/api/.env');

const src = fs.readFileSync(srcPath, 'utf8');
const dst = fs.readFileSync(dstPath, 'utf8');
const get = (key) => src.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? '';

const carry = {
  MONGODB_URI: get('MONGODB_URI').replace(/\/pharmaos(\?|$)/, '/relaxgo$1'), // same cluster, own database
  DNS_SERVERS: get('DNS_SERVERS'),
  FIREBASE_SERVICE_ACCOUNT_BASE64: get('FIREBASE_SERVICE_ACCOUNT_BASE64'),
  BREVO_API_KEY: get('BREVO_API_KEY'),
  EMAIL_FROM_ADDRESS: get('EMAIL_FROM_ADDRESS'),
  CLOUDINARY_CLOUD_NAME: get('CLOUDINARY_CLOUD_NAME'),
  CLOUDINARY_API_KEY: get('CLOUDINARY_API_KEY'),
  CLOUDINARY_API_SECRET: get('CLOUDINARY_API_SECRET'),
};

let out = dst;
for (const [key, value] of Object.entries(carry)) {
  if (!value) continue;
  out = out.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
}
fs.writeFileSync(dstPath, out);
console.log('Carried over:', Object.entries(carry).filter(([, v]) => v).map(([k]) => k).join(', '));
console.log('MongoDB database set to "relaxgo" on the same cluster.');

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env, isProd } from '../config/env';
import { ApiError } from '../lib/errors';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per document image
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export const LOCAL_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

/**
 * Driver-document storage (spec §54): Cloudinary when configured (private-ish URLs, no local
 * state); a local ./uploads folder as the development fallback. Production requires Cloudinary.
 */
export async function uploadDocumentImage(input: { base64: string; mimeType: string; driverId: string }): Promise<{ url: string }> {
  const ext = ALLOWED.get(input.mimeType);
  if (!ext) throw ApiError.unprocessable('Unsupported file type', { mimeType: 'Use JPEG, PNG, WebP or PDF' });
  const buffer = Buffer.from(input.base64, 'base64');
  if (!buffer.length) throw ApiError.unprocessable('Empty file', { base64: 'Required' });
  if (buffer.length > MAX_BYTES) throw ApiError.unprocessable('File too large (max 8 MB)', { base64: 'Too large' });

  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    return cloudinaryUpload(buffer, input);
  }
  if (isProd) throw ApiError.conflict('Document storage is not configured. Contact support.');

  // Dev fallback: local disk, served by the API at /uploads.
  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
  const name = `${input.driverId}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(LOCAL_UPLOAD_DIR, name), buffer);
  return { url: `http://localhost:${env.PORT}/uploads/${name}` };
}

/** Signed upload via Cloudinary's REST API — no SDK dependency needed for one endpoint. */
async function cloudinaryUpload(buffer: Buffer, input: { mimeType: string; driverId: string }): Promise<{ url: string }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'relaxgo/driver-documents';
  const publicId = `${input.driverId}-${timestamp}-${randomBytes(4).toString('hex')}`;
  const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const signature = createHash('sha1').update(toSign).digest('hex');

  const form = new FormData();
  form.set('file', `data:${input.mimeType};base64,${buffer.toString('base64')}`);
  form.set('api_key', env.CLOUDINARY_API_KEY!);
  form.set('timestamp', String(timestamp));
  form.set('folder', folder);
  form.set('public_id', publicId);
  form.set('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/auto/upload`, { method: 'POST', body: form });
  if (!res.ok) throw ApiError.conflict(`Document upload failed (${res.status}). Try again.`);
  const data = (await res.json()) as { secure_url: string };
  return { url: data.secure_url };
}

import 'server-only';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';

// Where farm photos are kept. Two drivers, chosen by MEDIA_DRIVER:
//   local  files under MEDIA_DIR (default ./data/media), served by /media/…
//          Right for a laptop or a VPS with a disk.
//   s3     any S3-compatible bucket: Cloudflare R2 (10 GB free, no egress
//          fees), Backblaze B2, MinIO. Needed on hosts without a lasting disk
//          (Vercel, Render free, Koyeb). Set S3_ENDPOINT, S3_BUCKET,
//          S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and NEXT_PUBLIC_MEDIA_URL.

export const MEDIA_PATH_RE = /^farms\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/;
export const MAX_PHOTO_BYTES = 2_000_000;
export const MAX_PHOTOS_PER_FARM = 8;

const driver = (process.env.MEDIA_DRIVER ?? (process.env.S3_BUCKET ? 's3' : 'local')) as 'local' | 's3';
const localRoot = resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'media'));

let s3: AwsClient | null = null;
function s3Client(): AwsClient {
  s3 ??= new AwsClient({
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    service: 's3',
    region: process.env.S3_REGION ?? 'auto',
  });
  return s3;
}
const s3Url = (path: string) => `${(process.env.S3_ENDPOINT ?? '').replace(/\/$/, '')}/${process.env.S3_BUCKET}/${path}`;

function localPath(path: string): string {
  if (!MEDIA_PATH_RE.test(path)) throw new Error('bad media path');
  return join(/*turbopackIgnore: true*/ localRoot, path);
}

export async function putMedia(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  if (driver === 's3') {
    const response = await s3Client().fetch(s3Url(path), {
      method: 'PUT',
      body: new Uint8Array(bytes).buffer as ArrayBuffer,
      headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' },
    });
    if (!response.ok) throw new Error(`storage upload failed (${response.status})`);
    return;
  }
  const file = localPath(path);
  await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ file, bytes);
}

export async function deleteMedia(path: string): Promise<void> {
  if (driver === 's3') {
    await s3Client().fetch(s3Url(path), { method: 'DELETE' });
    return;
  }
  await unlink(/*turbopackIgnore: true*/ localPath(path)).catch(() => undefined);
}

export async function readLocalMedia(path: string): Promise<Buffer | null> {
  if (driver !== 'local' || !MEDIA_PATH_RE.test(path)) return null;
  return readFile(/*turbopackIgnore: true*/ localPath(path)).catch(() => null);
}

/** Identify the image type from its first bytes; the browser's declared type is not trusted. */
export function sniffImage(bytes: Uint8Array): { ext: 'webp' | 'jpg' | 'png'; type: string } | null {
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: 'webp', type: 'image/webp' };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', type: 'image/png' };
  }
  return null;
}

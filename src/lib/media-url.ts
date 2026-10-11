// Public URL of a stored farm photo. Safe for client components.
// Local disk: served by our own /media route. S3-compatible bucket (e.g.
// Cloudflare R2 with public access): set NEXT_PUBLIC_MEDIA_URL to its URL.
const BASE = (process.env.NEXT_PUBLIC_MEDIA_URL ?? '/media').replace(/\/$/, '');

export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${BASE}/${path}`;
}

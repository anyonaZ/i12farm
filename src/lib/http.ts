import 'server-only';
import type { NextRequest } from 'next/server';
import { siteUrl } from '@/lib/env';

/** CSRF guard for form posts to route handlers: the request must come from our own pages. */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') === 'same-origin';
  const allowed = new Set([new URL(request.url).origin, new URL(siteUrl).origin]);
  return allowed.has(origin);
}

export function safeNextPath(raw: string | null | undefined, fallback = '/my-farm'): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : fallback;
}

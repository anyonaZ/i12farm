import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/session';

// Next.js 16 "proxy" (formerly middleware).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static files, the service worker, icons and the manifest.
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|api/events|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};

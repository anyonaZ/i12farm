import { NextResponse, type NextRequest } from 'next/server';
import { isGoogleConfigured, OAUTH_COOKIE, startGoogle } from '@/lib/auth/google';
import { siteUrl } from '@/lib/env';
import { safeNextPath } from '@/lib/http';

// Starts "Continue with Google". State and PKCE verifier live in a short-lived httpOnly cookie.
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  if (!isGoogleConfigured) return NextResponse.redirect(new URL(`/sign-in?error=google_off&next=${encodeURIComponent(next)}`, request.url));
  const { url, cookie } = startGoogle(next);
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: siteUrl.startsWith('https://'),
    sameSite: 'lax',
    path: '/auth/google',
    maxAge: 600,
  });
  return response;
}

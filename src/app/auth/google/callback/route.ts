import { NextResponse, type NextRequest } from 'next/server';
import { getLocale } from 'next-intl/server';
import { recordAttempt, userForGoogle } from '@/lib/auth/accounts';
import { finishGoogle, OAUTH_COOKIE } from '@/lib/auth/google';
import { requestInfo, startSession } from '@/lib/auth/session';
import { recordEvent } from '@/lib/analytics/server';
import { withUser } from '@/lib/db';
import { safeNextPath } from '@/lib/http';

export async function GET(request: NextRequest) {
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/sign-in?error=${reason}`, request.url));
    response.cookies.delete({ name: OAUTH_COOKIE, path: '/auth/google' });
    return response;
  };

  let saved: { state?: string; verifier?: string; next?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(OAUTH_COOKIE)?.value ?? '{}');
  } catch {
    return fail('google');
  }
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (!code || !state || !saved.state || state !== saved.state || !saved.verifier) return fail('google');

  const profile = await finishGoogle(code, saved.verifier).catch(() => null);
  if (!profile) return fail('google');

  const { ip } = await requestInfo();
  const locale = (await getLocale()) === 'sw' ? 'sw' : 'en';
  const result = await userForGoogle({ ...profile, locale });
  await recordAttempt({
    identifier: `google:${profile.sub}`,
    method: 'google',
    success: result.ok,
    reason: result.ok ? undefined : result.error,
    userId: result.ok ? result.userId : null,
    ip,
  });
  if (!result.ok) return fail(result.error === 'suspended' ? 'suspended' : 'google');

  await startSession(result.userId, 'google');
  await withUser(result.userId, (tx) =>
    recordEvent(tx, { name: 'auth.signed_in', userId: result.userId, properties: { provider: 'google' }, path: '/auth/google/callback' }),
  );
  const response = NextResponse.redirect(new URL(safeNextPath(saved.next), request.url));
  response.cookies.delete({ name: OAUTH_COOKIE, path: '/auth/google' });
  return response;
}

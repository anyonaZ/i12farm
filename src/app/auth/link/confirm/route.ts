import { NextResponse, type NextRequest } from 'next/server';
import { consumeSignInLink, recordAttempt } from '@/lib/auth/accounts';
import { requestInfo, startSession } from '@/lib/auth/session';
import { recordEvent } from '@/lib/analytics/server';
import { withUser } from '@/lib/db';
import { safeNextPath, sameOrigin } from '@/lib/http';

// One-time sign-in link from an email, or one an admin issued for a farmer
// who forgot their password. The link opens /auth/link, whose button posts
// here (so email scanners that pre-open links can't use up the token).
// Admin links land on Account so a new password can be set straight away.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const form = await request.formData();
  const token = String(form.get('token') ?? '');
  const nextParam = String(form.get('next') ?? '') || null;
  const { ip } = await requestInfo();
  const result = await consumeSignInLink(token);
  await recordAttempt({ identifier: 'link', method: 'link', success: result.ok, userId: result.ok ? result.userId : null, ip });
  if (!result.ok) return NextResponse.redirect(new URL('/sign-in?error=link', request.url), { status: 303 });

  await startSession(result.userId, result.purpose);
  await withUser(result.userId, (tx) =>
    recordEvent(tx, { name: 'auth.signed_in', userId: result.userId, properties: { provider: result.purpose }, path: '/auth/link' }),
  );
  const fallback = result.purpose === 'admin_link' ? '/account?set=password' : '/my-farm';
  return NextResponse.redirect(new URL(safeNextPath(nextParam, fallback), request.url), { status: 303 });
}

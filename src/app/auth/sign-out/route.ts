import { NextResponse, type NextRequest } from 'next/server';
import { endSession } from '@/lib/auth/session';
import { recordEvent } from '@/lib/analytics/server';
import { withUser } from '@/lib/db';
import { sameOrigin } from '@/lib/http';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const userId = await endSession('signed_out');
  if (userId) {
    await withUser(userId, (tx) => recordEvent(tx, { name: 'auth.signed_out', userId, path: '/auth/sign-out' })).catch(() => undefined);
  }
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}

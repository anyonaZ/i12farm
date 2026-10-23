import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { dispatchQueued } from '@/domains/notifications/dispatch';

// Sends queued SMS. The server also does this every 30 s by itself; call this
// from a scheduler on hosts that pause idle servers (serverless, free tiers):
// GET or POST with "Authorization: Bearer <CRON_SECRET>", every minute or two.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (secret.length < 24 || a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse(null, { status: 404 });
  return NextResponse.json(await dispatchQueued(), { headers: { 'cache-control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;

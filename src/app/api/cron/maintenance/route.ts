import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSql } from '@/lib/db';

// Order upkeep for hosts with a scheduler (Vercel Cron, cron-job.org, a VPS
// crontab): GET or POST with "Authorization: Bearer <CRON_SECRET>".
// The nightly GitHub workflow runs the same function directly in SQL.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (secret.length < 24 || a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse(null, { status: 404 });
  const [{ result }] = await getSql()<{ result: unknown }[]>`select public.run_maintenance() as result`;
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;

import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/auth/session';
import { withUser } from '@/lib/db';

// Tab-bar badges: orders waiting, unread conversations, open vet requests.
// Visitors get {} (no error), so the tab bar can ask without knowing who is signed in.
export async function GET() {
  const userId = await currentUserId().catch(() => null);
  if (!userId) return NextResponse.json({}, { headers: { 'cache-control': 'no-store' } });
  const [row] = await withUser(userId, (tx) => tx<{ c: Record<string, number> }[]>`select public.nav_counts() as c`);
  return NextResponse.json(row?.c ?? {}, { headers: { 'cache-control': 'private, no-store' } });
}

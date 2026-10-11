import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';
import { messagesAfter } from '@/domains/messaging/queries';

// New messages since ?after=<id>. The conversation page polls this every few
// seconds while it is open (cheap: one indexed query; no websocket server needed).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const after = Math.max(0, Number(request.nextUrl.searchParams.get('after')) || 0);
  const rows = await withUser(viewer.id, (tx) => messagesAfter(tx, viewer.id, id, after));
  return NextResponse.json(rows, { headers: { 'cache-control': 'no-store' } });
}

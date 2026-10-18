import { NextResponse, type NextRequest } from 'next/server';
import { EXPORTS, toCsv } from '@/domains/admin/insights';
import { getViewer } from '@/lib/auth/viewer';

// CSV downloads for admins: orders, contacts, daily events, and the payout file.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const viewer = await getViewer();
  if (!viewer?.roles.includes('admin')) return new NextResponse(null, { status: 404 });
  const kind = (await params).kind.replace(/\.csv$/, '') as keyof typeof EXPORTS;
  const spec = EXPORTS[kind];
  if (!spec) return new NextResponse(null, { status: 404 });
  const rows = (await spec.query(viewer)) as unknown as Record<string, unknown>[];
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows, [...spec.columns]), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="i12farm-${kind}-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';

// Light status check the order page polls while waiting for M-Pesa.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  const { number } = await params;
  if (!/^[0-9A-F]{6,8}$/.test(number)) return NextResponse.json({ error: 'bad number' }, { status: 400 });
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<{ status: string; payment: string | null; updated_at: string }[]>`
    select o.status, o.updated_at::text as updated_at,
           (select p.status::text from public.payments p where p.order_id = o.id order by p.requested_at desc limit 1) as payment
    from public.orders o where o.number = ${number}`,
  );
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(row, { headers: { 'cache-control': 'no-store' } });
}

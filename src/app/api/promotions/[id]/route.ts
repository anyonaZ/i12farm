import { NextResponse, type NextRequest } from 'next/server';
import { getPromotion } from '@/domains/promotions/queries';
import { getViewer } from '@/lib/auth/viewer';

// Status the "Feature your farm" page polls while waiting for M-Pesa.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  const promo = await getPromotion(viewer, (await params).id);
  if (!promo) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(promo, { headers: { 'cache-control': 'no-store' } });
}

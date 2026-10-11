import { NextResponse, type NextRequest } from 'next/server';
import { searchFarms } from '@/domains/farms/queries';
import { currentUserId } from '@/lib/auth/session';

// Text search across farms, products (English and Kiswahili) and places: /api/farms/search?q=&cat=&county=
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const q = (p.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json([]);
  const category = p.get('cat');
  const county = Number(p.get('county')) || null;
  const rows = await searchFarms(await currentUserId(), q, category && /^[a-z0-9-]{2,40}$/.test(category) ? category : null, county);
  return NextResponse.json(rows, { headers: { 'cache-control': 'private, max-age=15' } });
}

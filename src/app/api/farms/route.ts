import { NextResponse, type NextRequest } from 'next/server';
import { farmsInBox } from '@/domains/farms/queries';
import { currentUserId } from '@/lib/auth/session';

// Farms in the map's bounding box: /api/farms?w=&s=&e=&n=&cat=&county=
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const box = { west: Number(p.get('w')), south: Number(p.get('s')), east: Number(p.get('e')), north: Number(p.get('n')) };
  if (!Object.values(box).every((v) => Number.isFinite(v) && Math.abs(v) <= 180)) {
    return NextResponse.json({ error: 'bad box' }, { status: 400 });
  }
  const category = p.get('cat');
  const county = Number(p.get('county')) || null;
  const rows = await farmsInBox(await currentUserId(), box, category && /^[a-z0-9-]{2,40}$/.test(category) ? category : null, county);
  return NextResponse.json(rows, { headers: { 'cache-control': 'private, max-age=15' } });
}

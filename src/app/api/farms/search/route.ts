import { after, NextResponse, type NextRequest } from 'next/server';
import { searchFarms } from '@/domains/farms/queries';
import { logSearch } from '@/domains/insights/queries';
import { currentUserId } from '@/lib/auth/session';

// Text search across farms, products (English and Kiswahili) and places:
// /api/farms/search?q=&cat=&county=&lng=&lat=
// Each search is also logged, anonymously, for demand signals (what buyers look
// for in each county). The device id comes from the x-i12f-device header; lng/lat
// (the middle of the map) tell which county the buyer was looking at.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const q = (p.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json([]);
  const raw = p.get('cat');
  const category = raw && /^[a-z0-9-]{2,40}$/.test(raw) ? raw : null;
  const county = Number(p.get('county')) || null;
  const rows = await searchFarms(await currentUserId(), q, category, county);

  const device = request.headers.get('x-i12f-device');
  const lng = Number(p.get('lng'));
  const lat = Number(p.get('lat'));
  after(() =>
    logSearch({
      term: q,
      county,
      category,
      results: rows.length,
      device: device && /^[A-Za-z0-9-]{8,64}$/.test(device) ? device : null,
      lng: Number.isFinite(lng) && p.has('lng') ? lng : null,
      lat: Number.isFinite(lat) && p.has('lat') ? lat : null,
    }),
  );
  return NextResponse.json(rows, { headers: { 'cache-control': 'private, max-age=15' } });
}

import { ImageResponse } from 'next/og';
import { getFarmBySlug } from '@/domains/farms/queries';
import { listFarmCategories } from '@/domains/reference/queries';

// Link preview picture for farms without a photo (WhatsApp, Facebook, SMS apps):
// the farm's name, place and type on the brand green. 1200×630, cached a day.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const farm = await getFarmBySlug((await params).slug);
  if (!farm) return new Response(null, { status: 404 });
  const categories = (await listFarmCategories('en')) ?? [];
  const types = farm.categories
    .map((c) => categories.find((x) => x.slug === c)?.name ?? c)
    .slice(0, 3)
    .join(' · ');
  const place = [farm.place_name, farm.county?.name].filter(Boolean).join(', ');
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0A1F16',
        padding: 72,
        color: 'white',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 40, fontWeight: 700 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: '#C6F36B', display: 'flex' }} />
        i12farm
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: farm.name.length > 26 ? 72 : 92, fontWeight: 700, lineHeight: 1.05 }}>{farm.name}</div>
        <div style={{ fontSize: 40, color: '#cdeee0' }}>{place}</div>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 34 }}>
        <div style={{ display: 'flex', background: '#047857', borderRadius: 999, padding: '10px 28px' }}>{types}</div>
        {farm.verified_at ? (
          <div style={{ display: 'flex', background: '#C6F36B', color: '#0A1F16', borderRadius: 999, padding: '10px 28px' }}>
            Verified farm
          </div>
        ) : null}
      </div>
    </div>,
    { width: 1200, height: 630, headers: { 'cache-control': 'public, max-age=86400' } },
  );
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { getFarmBySlug } from '@/domains/farms/queries';
import { listFarmCategories } from '@/domains/reference/queries';

// Link preview picture for farms without a photo (WhatsApp, Facebook, SMS apps):
// the farm's name, place and type on Forest Ink with the reversed i12farm
// logo, as the brand guide asks for social posts. 1200×630, cached a day.
let logo: Promise<string> | null = null;
const reversedLogo = () =>
  (logo ??= readFile(join(process.cwd(), 'public/icons/logo-reversed.svg')).then(
    (b) => `data:image/svg+xml;base64,${b.toString('base64')}`,
  ));

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const farm = await getFarmBySlug((await params).slug);
  if (!farm) return new Response(null, { status: 404 });
  const categories = (await listFarmCategories('en')) ?? [];
  const types = farm.categories
    .map((c) => categories.find((x) => x.slug === c)?.name ?? c)
    .slice(0, 3)
    .join(' · ');
  const place = [farm.place_name, farm.county?.name].filter(Boolean).join(', ');
  const logoSrc = await reversedLogo();
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoSrc} width={300} height={90} alt="i12farm" />
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

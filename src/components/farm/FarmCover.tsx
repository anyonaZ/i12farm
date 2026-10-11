import { CATEGORY_HUE, CATEGORY_ICON, ICON_PATHS } from '@/components/Icon';
import { publicMediaUrl } from '@/lib/storage';

// A farm's first photo, or a generated cover (category colour, contour lines,
// category icon) so farms without photos still look cared for.

function seeded(seed: string) {
  let x = 0;
  for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function FarmCover({
  id,
  name,
  category,
  coverPath,
  className,
  sizes = '(max-width: 480px) 100vw, 480px',
}: {
  id: string;
  name: string;
  category: string | undefined;
  coverPath?: string | null;
  className?: string;
  sizes?: string;
}) {
  const url = publicMediaUrl(coverPath);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} sizes={sizes} loading="lazy" decoding="async" className={`h-full w-full object-cover ${className ?? ''}`} />;
  }
  const cat = category ?? 'vegetables';
  const hue = CATEGORY_HUE[cat] ?? 140;
  const r = seeded(id + name);
  const lines = Array.from({ length: 7 }, (_, i) => {
    const y = 20 + i * 18 + r() * 8;
    const a = 6 + r() * 10;
    return `M-10 ${y.toFixed(1)} C 60 ${(y - a).toFixed(1)}, 120 ${(y + a).toFixed(1)}, 210 ${(y - a / 2).toFixed(1)}`;
  });
  const gid = `cover-${id}`;
  return (
    <svg viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice" role="img" aria-label={name} className={`h-full w-full ${className ?? ''}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 55% 82%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 40) % 360} 45% 70%)`} />
        </linearGradient>
      </defs>
      <rect width="200" height="140" fill={`url(#${gid})`} />
      <g fill="none" stroke={`hsl(${hue} 40% 45%)`} strokeOpacity={0.35} strokeWidth={1.2}>
        {lines.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g transform="translate(118 46) scale(3.1)" fill="none" stroke={`hsl(${hue} 50% 28%)`} strokeOpacity={0.55} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON_PATHS[CATEGORY_ICON[cat] ?? 'leaf']} />
      </g>
    </svg>
  );
}

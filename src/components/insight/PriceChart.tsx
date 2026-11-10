'use client';

import { useEffect, useRef, useState } from 'react';

export interface ChartPoint {
  week: string; // yyyy-mm-dd
  median: number;
  min: number;
  max: number;
  farms: number;
}

// One product's weekly median (line) and the range across farms (band).
// Hover or tap a week for the numbers; a table with the same numbers sits below
// for screen readers and anyone who prefers it.
export function PriceChart({
  points,
  locale,
  labels,
}: {
  points: ChartPoint[];
  locale: string;
  labels: { median: string; range: string; farms: string; week: string; chart: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the box's real width so the labels stay 12 px on any screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 500 ? 220 : 260;
  const m = { top: 16, right: 16, bottom: 28, left: 56 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const lo = Math.min(...points.map((p) => p.min));
  const hi = Math.max(...points.map((p) => p.max));
  const pad = (hi - lo) * 0.1 || hi * 0.1 || 1;
  const y0 = Math.max(0, lo - pad);
  const y1 = hi + pad;
  const x = (i: number) => m.left + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v: number) => m.top + (1 - (v - y0) / (y1 - y0)) * ih;
  const ticks = niceTicks(y0, y1, 4);

  const money = (v: number) => v.toLocaleString('en-KE', { maximumFractionDigits: 0 });
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale === 'sw' ? 'sw-KE' : 'en-KE', { day: 'numeric', month: 'short' });

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.median).toFixed(1)}`).join(' ');
  const band =
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.max).toFixed(1)}`).join(' ') +
    ' ' +
    [...points]
      .reverse()
      .map((p, j) => `L${x(points.length - 1 - j).toFixed(1)} ${y(p.min).toFixed(1)}`)
      .join(' ') +
    ' Z';
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(W / 90))));
  const h = hover === null ? null : points[hover];
  const slot = points.length > 1 ? iw / (points.length - 1) : iw;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-soil">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-sprout-deep" aria-hidden="true" />
          {labels.median}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm bg-sprout/20" aria-hidden="true" />
          {labels.range}
        </span>
      </div>
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full touch-pan-y" role="img" aria-label={labels.chart}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} stroke="#d8eadf" strokeWidth="1" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="12" fill="#5b6b63">
                {money(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % every === 0 || i === points.length - 1 ? (
              <text key={p.week} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="#5b6b63">
                {day(p.week)}
              </text>
            ) : null,
          )}
          <path d={band} fill="#12b76a" opacity="0.18" />
          <path d={line} fill="none" stroke="#067647" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {h ? (
            <line x1={x(hover!)} x2={x(hover!)} y1={m.top} y2={m.top + ih} stroke="#053b2b" strokeWidth="1" strokeDasharray="3 3" />
          ) : null}
          {points.map((p, i) => (
            <circle
              key={p.week}
              cx={x(i)}
              cy={y(p.median)}
              r={hover === i ? 6 : i === points.length - 1 ? 4.5 : 0}
              fill="#067647"
              stroke="#fff"
              strokeWidth="2"
            />
          ))}
          {points.map((p, i) => (
            <rect
              key={p.week}
              x={x(i) - slot / 2}
              y={m.top}
              width={slot}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(hover === i ? null : i)}
            />
          ))}
        </svg>
        {h ? (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(x(hover!) / W) * 100}%`,
              transform: x(hover!) > W * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
            role="status"
          >
            <p className="font-bold text-forest">{labels.week.replace('{date}', day(h.week))}</p>
            <p className="tabular-nums">
              {labels.median}: <b>KES {money(h.median)}</b>
            </p>
            <p className="tabular-nums text-soil">
              {labels.range}: {money(h.min)} – {money(h.max)}
            </p>
            <p className="text-soil">{labels.farms.replace('{n}', String(h.farms))}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

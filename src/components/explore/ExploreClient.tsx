'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FarmMap, type Bounds } from '@/components/map/FarmMap';
import { FarmCard } from '@/components/farm/FarmCard';
import { Icon, CATEGORY_ICON } from '@/components/Icon';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/lib/analytics/track';
import type { FarmSummary } from '@/domains/farms/types';

interface Props {
  categories: { slug: string; name: string }[];
  counties: { code: number; name: string; focus: [number, number] | null }[];
}

const KENYA_VIEW: { center: [number, number]; zoom: number } = { center: [35.6, -0.7], zoom: 6.2 };
const SHEET_COLLAPSED = 214;

export function ExploreClient({ categories, counties }: Props) {
  const t = useTranslations('explore');
  const supabase = useMemo(() => createClient(), []);
  const [inView, setInView] = useState<FarmSummary[]>([]);
  const [results, setResults] = useState<FarmSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [county, setCounty] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState(KENYA_VIEW);
  const [flyKey, setFlyKey] = useState(0);
  const [fitKey, setFitKey] = useState(0);
  const [fitPoints, setFitPoints] = useState<[number, number][]>(
    counties.map((c) => c.focus).filter((f): f is [number, number] => f !== null),
  );
  const bounds = useRef<Bounds | null>(null);
  const request = useRef(0);

  const categoryName = useCallback(
    (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug,
    [categories],
  );

  const loadInView = useCallback(async () => {
    const b = bounds.current;
    if (!b) return;
    const id = ++request.current;
    // Ask for a slightly larger box so small pans don't refetch empty edges.
    const padLng = (b.east - b.west) * 0.15;
    const padLat = (b.north - b.south) * 0.15;
    const { data, error } = await supabase.rpc('farms_in_bbox', {
      min_lng: b.west - padLng,
      min_lat: b.south - padLat,
      max_lng: b.east + padLng,
      max_lat: b.north + padLat,
      category_filter: cat ? [cat] : null,
      county_filter: county,
      max_rows: 500,
    });
    if (id !== request.current || error) return;
    setInView((data ?? []) as FarmSummary[]);
  }, [supabase, cat, county]);

  useEffect(() => {
    loadInView();
  }, [loadInView]);

  // Text search covers every pilot county (and farms hidden from the map).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_farms', {
        q: term,
        category_filter: cat ? [cat] : null,
        county_filter: county,
        max_rows: 50,
      });
      const rows = (data ?? []) as FarmSummary[];
      setResults(rows);
      track('search.performed', { q: term.slice(0, 40), results: rows.length });
      const pts = rows.filter((r) => r.lng !== null && r.lat !== null).map((r) => [r.lng, r.lat] as [number, number]);
      if (pts.length) {
        setFitPoints(pts);
        setFitKey((k) => k + 1);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [q, cat, county, supabase]);

  const visibleInBounds = useMemo(() => {
    const b = bounds.current;
    if (!b) return inView;
    return inView.filter((f) => f.lng !== null && f.lat !== null && f.lng >= b.west && f.lng <= b.east && f.lat >= b.south && f.lat <= b.north);
    // inView changes after every move, which is when bounds change too
  }, [inView]);

  const list = results ?? visibleInBounds;
  const sorted = useMemo(
    () => [...list].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || Number(b.verified) - Number(a.verified)),
    [list, selected],
  );
  const points = useMemo(
    () =>
      (results ?? inView)
        .filter((f) => f.lng !== null && f.lat !== null)
        .map((f) => ({ id: f.id, lng: f.lng as number, lat: f.lat as number, verified: f.verified })),
    [results, inView],
  );

  function chooseCounty(value: string) {
    const code = value ? Number(value) : null;
    setCounty(code);
    const c = counties.find((x) => x.code === code);
    if (c?.focus) {
      setView({ center: c.focus, zoom: 10 });
      setFlyKey((k) => k + 1);
      track('explore.county_selected', { county: c.code });
    } else {
      setFitPoints(counties.map((x) => x.focus).filter((f): f is [number, number] => f !== null));
      setFitKey((k) => k + 1);
    }
  }

  const padding = { top: 130, bottom: SHEET_COLLAPSED + 24, left: 32, right: 64 };

  return (
    <div className="relative h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] overflow-hidden">
      <FarmMap
        className="absolute inset-0"
        label="Map of farms"
        center={view.center}
        zoom={view.zoom}
        flyKey={flyKey}
        fitKey={fitKey}
        fitPoints={fitPoints}
        padding={padding}
        points={points}
        selectedId={selected}
        onSelect={(id) => {
          setSelected(id);
          if (id) track('map.pin_tapped', { farm: id });
        }}
        onMoveEnd={(b, zoom) => {
          bounds.current = b;
          loadInView();
          track('map.moved', { zoom: Math.round(zoom * 10) / 10 });
        }}
      />

      <div className="pointer-events-none absolute inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex flex-col gap-2.5">
        <div role="search" className="pointer-events-auto flex min-h-13 items-center gap-2.5 rounded-full border border-line bg-surface pl-4 pr-2 shadow-lg">
          <Icon name="search" className="shrink-0 text-soil" />
          <label htmlFor="explore-q" className="sr-only">
            {t('searchPlaceholder')}
          </label>
          <input
            id="explore-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-soil"
          />
          <label htmlFor="explore-county" className="sr-only">
            {t('allCounties')}
          </label>
          <select
            id="explore-county"
            value={county ?? ''}
            onChange={(e) => chooseCounty(e.target.value)}
            className="h-9 max-w-[38%] rounded-full bg-mint px-2.5 text-sm font-semibold"
          >
            <option value="">{t('allCounties')}</option>
            {counties.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pointer-events-auto -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="toolbar" aria-label="Categories">
          <Chip pressed={cat === null} onClick={() => setCat(null)}>
            {t('all')}
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c.slug}
              pressed={cat === c.slug}
              onClick={() => {
                setCat(c.slug);
                track('explore.category_tapped', { category: c.slug });
              }}
            >
              <Icon name={CATEGORY_ICON[c.slug] ?? 'leaf'} size={16} />
              {c.name}
            </Chip>
          ))}
        </div>
      </div>

      <section
        aria-label={t('inArea', { n: list.length })}
        className="absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-[22px] border-t border-line bg-surface shadow-[0_-6px_24px_rgba(5,59,43,0.12)] transition-[height] duration-300"
        style={{ height: sheetOpen ? 'calc(100% - 4rem)' : SHEET_COLLAPSED }}
      >
        <button
          type="button"
          onClick={() => setSheetOpen((o) => !o)}
          aria-expanded={sheetOpen}
          className="flex flex-col items-center gap-2 px-4 pb-1.5 pt-2"
        >
          <span className="h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
          <span className="flex w-full items-center justify-between">
            <span className="text-base font-bold">{results ? t('results', { n: list.length }) : t('inArea', { n: list.length })}</span>
            <span className="text-sm font-bold text-sprout-deep">{sheetOpen ? t('showMap') : t('showList')}</span>
          </span>
        </button>
        {list.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-soil">{t('emptyArea')}</p>
        ) : sheetOpen ? (
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6 pt-1">
            {sorted.map((f) => (
              <FarmCard key={f.id} farm={f} layout="wide" categoryName={categoryName} />
            ))}
          </div>
        ) : (
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3.5 pt-1 [scrollbar-width:none]">
            {sorted.map((f) => (
              <FarmCard key={f.id} farm={f} layout="compact" selected={f.id === selected} categoryName={categoryName} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold shadow-sm ${
        pressed ? 'border-forest bg-forest text-white' : 'border-line bg-surface text-forest'
      }`}
    >
      {children}
    </button>
  );
}

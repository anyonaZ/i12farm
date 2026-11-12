'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FarmMap, type Bounds } from '@/components/map/FarmMap';
import { FarmCard } from '@/components/farm/FarmCard';
import { ScrollRow } from '@/components/ScrollRow';
import { Icon, CATEGORY_ICON } from '@/components/Icon';
import { getAnonymousId, track } from '@/lib/analytics/track';
import { DESKTOP, useMedia } from '@/lib/use-media';
import type { FarmSummary } from '@/domains/farms/types';

interface Props {
  categories: { slug: string; name: string }[];
  counties: { code: number; name: string; focus: [number, number] | null }[];
  /** From the link (/?q=milk&county=47), e.g. "Find farms" on the prices page. */
  initialQ?: string;
  initialCounty?: number | null;
}

const KENYA_VIEW: { center: [number, number]; zoom: number } = { center: [35.6, -0.7], zoom: 6.2 };
const SHEET_COLLAPSED = 214;

export function ExploreClient({ categories, counties, initialQ = '', initialCounty = null }: Props) {
  const t = useTranslations('explore');
  const tAll = useTranslations();
  const [inView, setInView] = useState<FarmSummary[]>([]);
  const [results, setResults] = useState<FarmSummary[] | null>(null);
  const [q, setQ] = useState(initialQ);
  const [cat, setCat] = useState<string | null>(null);
  const [county, setCounty] = useState<number | null>(initialCounty);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const desktop = useMedia(DESKTOP);
  const listRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState(KENYA_VIEW);
  const [flyKey, setFlyKey] = useState(0);
  const [fitKey, setFitKey] = useState(0);
  const [fitPoints, setFitPoints] = useState<[number, number][]>(
    counties.map((c) => c.focus).filter((f): f is [number, number] => f !== null),
  );
  // Start with all of Kenya so the list fills even if map tiles are slow or fail to load.
  const bounds = useRef<Bounds | null>({ west: 33.9, south: -4.7, east: 41.9, north: 5.0 });
  const request = useRef(0);
  // The first load covers all of Kenya; frame the map on those farms once, so
  // every farm counted at first is also on screen (the count doesn't jump).
  const framed = useRef(false);

  const categoryName = useCallback((slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug, [categories]);

  const loadInView = useCallback(async () => {
    const b = bounds.current;
    if (!b) return;
    const id = ++request.current;
    // Ask for a slightly larger box so small pans don't refetch empty edges.
    const padLng = (b.east - b.west) * 0.15;
    const padLat = (b.north - b.south) * 0.15;
    const params = new URLSearchParams({
      w: String(b.west - padLng),
      s: String(b.south - padLat),
      e: String(b.east + padLng),
      n: String(b.north + padLat),
    });
    if (cat) params.set('cat', cat);
    if (county) params.set('county', String(county));
    const response = await fetch(`/api/farms?${params}`).catch(() => null);
    if (id !== request.current || !response?.ok) return;
    const rows = (await response.json()) as FarmSummary[];
    setInView(rows);
    if (!framed.current) {
      framed.current = true;
      const pts = rows.filter((r) => r.lng !== null && r.lat !== null).map((r) => [r.lng, r.lat] as [number, number]);
      if (pts.length > 1 && !county) {
        setFitPoints(pts);
        setFitKey((k) => k + 1);
      }
    }
  }, [cat, county]);

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
      const params = new URLSearchParams({ q: term });
      if (cat) params.set('cat', cat);
      if (county) params.set('county', String(county));
      const b = bounds.current;
      if (b) {
        params.set('lng', ((b.west + b.east) / 2).toFixed(3));
        params.set('lat', ((b.south + b.north) / 2).toFixed(3));
      }
      const response = await fetch(`/api/farms/search?${params}`, { headers: { 'x-i12f-device': getAnonymousId() } }).catch(() => null);
      const rows = (response?.ok ? await response.json() : []) as FarmSummary[];
      setResults(rows);
      track('search.performed', { q: term.slice(0, 40), results: rows.length });
      const pts = rows.filter((r) => r.lng !== null && r.lat !== null).map((r) => [r.lng, r.lat] as [number, number]);
      if (pts.length) {
        setFitPoints(pts);
        setFitKey((k) => k + 1);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [q, cat, county]);

  const visibleInBounds = useMemo(() => {
    const b = bounds.current;
    if (!b) return inView;
    return inView.filter(
      (f) => f.lng !== null && f.lat !== null && f.lng >= b.west && f.lng <= b.east && f.lat >= b.south && f.lat <= b.north,
    );
    // inView changes after every move, which is when bounds change too
  }, [inView]);

  const list = results ?? visibleInBounds;
  const sorted = useMemo(
    () =>
      [...list].sort(
        (a, b) =>
          Number(b.id === selected) - Number(a.id === selected) ||
          Number(b.featured) - Number(a.featured) ||
          Number(b.verified) - Number(a.verified),
      ),
    [list, selected],
  );
  // Desktop keeps a stable order (the list must not jump while the mouse moves over it).
  const desktopSorted = useMemo(
    () => [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.verified) - Number(a.verified)),
    [list],
  );

  // A pin clicked on the desktop map scrolls its farm into view in the list.
  useEffect(() => {
    if (!desktop || !selected) return;
    listRef.current?.querySelector(`[data-farm-id="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [desktop, selected]);

  const points = useMemo(
    () =>
      (results ?? inView)
        .filter((f) => f.lng !== null && f.lat !== null)
        .map((f) => ({ id: f.id, lng: f.lng as number, lat: f.lat as number, verified: f.verified })),
    [results, inView],
  );

  // Say what is narrowing the results, and offer the one tap that widens them.
  const countyName = counties.find((c) => c.code === county)?.name;
  const catLabel = categories.find((c) => c.slug === cat)?.name;
  const emptyState = (compact: boolean) => (
    <div className={compact ? 'flex flex-col items-start gap-2 px-4 pb-4' : 'flex flex-col items-start gap-3'}>
      <p className={compact ? 'text-sm text-soil' : 'text-soil'}>
        {q.trim() && (county || cat)
          ? t('emptySearchFiltered', { q: q.trim(), where: [catLabel, countyName].filter(Boolean).join(', ') })
          : q.trim()
            ? t('emptySearch', { q: q.trim() })
            : t('emptyArea')}
      </p>
      {county || cat ? (
        <button
          type="button"
          onClick={() => {
            setCat(null);
            chooseCounty('');
          }}
          className="btn-secondary min-h-11 w-auto px-4 text-sm"
        >
          {t('searchEverywhere')}
        </button>
      ) : null}
    </div>
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

  const searchBar = (
    <div
      role="search"
      className="pointer-events-auto flex min-h-13 items-center gap-2.5 rounded-full border border-line bg-surface pl-4 pr-2 shadow-lg lg:shadow-sm"
    >
      <Icon name="search" className="shrink-0 text-soil" />
      <label htmlFor="explore-q" className="sr-only">
        {t('searchPlaceholder')}
      </label>
      <input
        id="explore-q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchShort')}
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
        className="h-11 max-w-[38%] rounded-full bg-mint px-3 text-sm font-semibold"
      >
        <option value="">{t('allCounties')}</option>
        {counties.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );

  const chips = (
    <ScrollRow className="-mx-4 gap-2 px-4 pb-1 lg:mx-0 lg:px-0" role="toolbar" label={t('categoriesLabel')}>
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
      <Link
        href="/prices"
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-sprout/40 bg-mint px-3.5 text-sm font-semibold text-sprout-deep shadow-sm lg:hidden"
      >
        <Icon name="trend" size={16} />
        {tAll('prices.title')}
      </Link>
    </ScrollRow>
  );

  const heading = results ? t('results', { n: list.length }) : t('inArea', { n: list.length });

  const map = (mapPadding: typeof padding) => (
    <FarmMap
      className="absolute inset-0"
      label="Map of farms"
      center={view.center}
      zoom={view.zoom}
      flyKey={flyKey}
      fitKey={fitKey}
      fitPoints={fitPoints}
      padding={mapPadding}
      points={points}
      selectedId={hovered ?? selected}
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
  );

  // Laptop and desktop: Airbnb-style list beside a large map. Hovering a farm
  // lights up its pin; clicking a pin scrolls to the farm in the list.
  if (desktop) {
    return (
      <div className="grid h-[calc(100dvh-4rem)] grid-cols-[minmax(440px,46%)_1fr] xl:grid-cols-[minmax(600px,52%)_1fr]">
        <section aria-label={heading} className="flex min-h-0 flex-col border-r border-line">
          <div className="flex flex-col gap-3 border-b border-line bg-surface px-6 pb-4 pt-5">
            {searchBar}
            {chips}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-4">
            <h2 className="mb-4 text-lg font-bold">{heading}</h2>
            {list.length === 0 ? (
              emptyState(false)
            ) : (
              <div className="grid grid-cols-1 gap-x-5 gap-y-8 xl:grid-cols-2">
                {desktopSorted.map((f) => (
                  <div
                    key={f.id}
                    data-farm-id={f.id}
                    onMouseEnter={() => setHovered(f.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(f.id)}
                    onBlur={() => setHovered(null)}
                    className={`rounded-2xl transition-shadow ${f.id === selected ? 'shadow-[0_0_0_3px_var(--color-sprout)]' : ''}`}
                  >
                    <FarmCard farm={f} layout="wide" categoryName={categoryName} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <div className="relative min-h-0">{map({ top: 48, bottom: 48, left: 48, right: 48 })}</div>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] overflow-hidden">
      {map(padding)}

      <div className="pointer-events-none absolute inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex flex-col gap-2.5">
        {searchBar}
        {chips}
      </div>

      <section
        aria-label={heading}
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
            <span className="text-base font-bold">{heading}</span>
            <span className="text-sm font-bold text-sprout-deep">{sheetOpen ? t('showMap') : t('showList')}</span>
          </span>
        </button>
        {list.length === 0 ? (
          emptyState(true)
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
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold shadow-sm ${
        pressed ? 'border-forest bg-forest text-white' : 'border-line bg-surface text-forest'
      }`}
    >
      {children}
    </button>
  );
}

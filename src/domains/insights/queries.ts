import 'server-only';
import { cache } from 'react';
import { isDbConfigured, withUser } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

// Phase 4 · Insight. Read-only, aggregated views built in SQL
// (db/migrations/20261110000200_insight.sql). Nothing here returns a person.

export interface PricePoint {
  week: string; // yyyy-mm-dd, Monday
  median_kes: number;
  min_kes: number;
  max_kes: number;
  farms: number;
}

export interface PriceSeries {
  product: string;
  unit: string;
  points: PricePoint[];
}

/** Weekly median price per product and unit, newest week last. County, or all of Kenya. */
export const priceIndex = cache(async (county: number | null, weeks = 12): Promise<PriceSeries[]> => {
  if (!isDbConfigured) return [];
  const rows = await withUser(
    null,
    (tx) => tx<{ product_slug: string; unit: string; week: Date; median_kes: string; min_kes: string; max_kes: string; farms: number }[]>`
    select product_slug, unit, week, median_kes, min_kes, max_kes, farms
    from public.price_index(${county}::integer, ${weeks}::integer, null)`,
  );
  const series = new Map<string, PriceSeries>();
  for (const r of rows) {
    const key = `${r.product_slug}|${r.unit}`;
    let s = series.get(key);
    if (!s) {
      s = { product: r.product_slug, unit: r.unit, points: [] };
      series.set(key, s);
    }
    s.points.push({
      week: new Date(r.week).toISOString().slice(0, 10),
      median_kes: Number(r.median_kes),
      min_kes: Number(r.min_kes),
      max_kes: Number(r.max_kes),
      farms: r.farms,
    });
  }
  return [...series.values()];
});

export interface Benchmark {
  scope: 'county' | 'kenya';
  median_kes: number;
  farms: number;
}

/** Today's median for each of a farm's listings (same product and unit), keyed by listing id. */
export async function priceBenchmarks(farmId: string): Promise<Record<string, Benchmark>> {
  if (!isDbConfigured) return {};
  const rows = await withUser(
    null,
    (tx) => tx<{ listing_id: string; scope: 'county' | 'kenya'; median_kes: string; farms: number }[]>`
    select listing_id, scope, median_kes, farms from public.price_benchmarks(${farmId}::uuid)`,
  ).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.listing_id, { scope: r.scope, median_kes: Number(r.median_kes), farms: r.farms }]));
}

export interface WantedTerm {
  term: string;
  searchers: number;
}

/** Everyday farm words buyers searched for and mostly didn't find (3+ devices). */
export async function unmetDemand(county: number | null): Promise<WantedTerm[]> {
  if (!isDbConfigured) return [];
  return withUser(null, (tx) => tx<WantedTerm[]>`select term, searchers from public.unmet_demand(${county}::integer, 30)`).catch(() => []);
}

/** Records a search for demand signals. Never throws: search must not fail because of this. */
export async function logSearch(input: {
  term: string;
  county: number | null;
  category: string | null;
  results: number;
  device: string | null;
  lng: number | null;
  lat: number | null;
}): Promise<void> {
  if (!isDbConfigured || !input.device) return;
  await withUser(
    null,
    (tx) => tx`select public.log_search(${input.term}, ${input.county}::integer, ${input.category}, ${input.results}::integer,
                                        ${input.device}, ${input.lng}::float8, ${input.lat}::float8)`,
  ).catch(() => undefined);
}

export interface DemandRow {
  term: string;
  searchers: number;
  searches: number;
  zero_share: number;
  typical_results: number;
}

export interface CountyInsight {
  county: number | null;
  days: number;
  min_count: number;
  as_of: string;
  farms: { published: number; verified: number; new: number; by_type: { slug: string; farms: number }[] };
  on_sale: { product: string; unit: string; farms: number; median_kes: number }[];
  trade:
    | { hidden: true; top_products: [] }
    | {
        hidden: false;
        orders: number;
        value_kes: number;
        buyers: number | null;
        farms: number;
        top_products: { product: string; orders: number; value_kes: number }[];
      };
  vets:
    { hidden: true; by_animal: [] } | { hidden: false; total: number; answered: number; by_animal: { animal: string; requests: number }[] };
  contacts: { total: number; farms: number };
  demand: { searched: DemandRow[]; unmet: DemandRow[] };
}

/** County dashboard for partners and admins (the database checks the role). */
export async function countyInsight(viewer: Viewer, county: number | null, days: number): Promise<CountyInsight> {
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<{ j: CountyInsight }[]>`select public.county_insight(${county}::integer, ${days}::integer) as j`,
  );
  return row.j;
}

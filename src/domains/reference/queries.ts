import 'server-only';
import { cache } from 'react';
import { isDbConfigured, withUser } from '@/lib/db';
import type { Locale } from '@/i18n/config';

// Reference data is public and small; read as an anonymous visitor, once per request.

export interface FarmCategory {
  slug: string;
  name: string;
  icon: string;
}

export interface County {
  code: number;
  name: string;
}

const categoriesRaw = cache(async () =>
  withUser(
    null,
    (tx) => tx<{ slug: string; name_en: string; name_sw: string; icon: string }[]>`
    select slug, name_en, name_sw, icon from public.farm_categories where active order by sort_order`,
  ),
);

export async function listFarmCategories(locale: Locale): Promise<FarmCategory[] | null> {
  if (!isDbConfigured) return null;
  const rows = await categoriesRaw().catch(() => null);
  return rows?.map((c) => ({ slug: c.slug, icon: c.icon, name: locale === 'sw' ? c.name_sw : c.name_en })) ?? null;
}

export async function listCounties(): Promise<County[] | null> {
  if (!isDbConfigured) return null;
  return withUser(null, (tx) => tx<County[]>`select code, name from public.counties order by name`).catch(() => null);
}

export const listPilotCounties = cache(async (): Promise<County[] | null> => {
  if (!isDbConfigured) return null;
  return withUser(null, (tx) => tx<County[]>`select code, name from public.counties where is_pilot order by name`).catch(() => null);
});

export interface Product {
  slug: string;
  category: string;
  name: string;
  unit: string;
}

export async function listProducts(locale: Locale): Promise<Product[]> {
  if (!isDbConfigured) return [];
  const rows = await withUser(
    null,
    (tx) => tx<{ slug: string; category_slug: string; name_en: string; name_sw: string; default_unit: string }[]>`
    select slug, category_slug, name_en, name_sw, default_unit from public.products where active order by name_en`,
  );
  return rows.map((p) => ({
    slug: p.slug,
    category: p.category_slug,
    unit: p.default_unit,
    name: locale === 'sw' ? p.name_sw : p.name_en,
  }));
}

export interface SubCounty {
  id: number;
  county_code: number;
  name: string;
}

export async function listPilotSubCounties(): Promise<SubCounty[]> {
  if (!isDbConfigured) return [];
  return withUser(
    null,
    (tx) => tx<SubCounty[]>`
    select s.id, s.county_code, s.name from public.sub_counties s
    join public.counties c on c.code = s.county_code and c.is_pilot
    order by s.name`,
  );
}

export interface PilotCounty extends County {
  focus: [number, number] | null;
}

// County focus points for centring the map; these match the reference_data migration.
export const COUNTY_FOCUS: Record<number, [number, number]> = {
  22: [36.835, -1.171],
  42: [34.768, -0.092],
  43: [34.457, -0.527],
  44: [34.473, -1.063],
  47: [36.817, -1.286],
};

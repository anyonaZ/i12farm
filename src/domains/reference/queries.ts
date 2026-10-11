import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { Locale } from '@/i18n/config';

export interface FarmCategory {
  slug: string;
  name: string;
  icon: string;
}

export interface County {
  code: number;
  name: string;
}

export async function listFarmCategories(locale: Locale): Promise<FarmCategory[] | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('farm_categories')
    .select('slug, name_en, name_sw, icon')
    .eq('active', true)
    .order('sort_order');
  if (error || !data) return null;
  return data.map((c) => ({ slug: c.slug, icon: c.icon, name: locale === 'sw' ? c.name_sw : c.name_en }));
}

export async function listCounties(): Promise<County[] | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('counties').select('code, name').order('name');
  if (error || !data) return null;
  return data;
}

export async function listPilotCounties(): Promise<County[] | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('counties').select('code, name').eq('is_pilot', true).order('name');
  if (error || !data) return null;
  return data;
}

export interface Product {
  slug: string;
  category: string;
  name: string;
  unit: string;
}

export async function listProducts(locale: Locale): Promise<Product[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('products')
    .select('slug, category_slug, name_en, name_sw, default_unit')
    .eq('active', true)
    .order('name_en');
  return (data ?? []).map((p) => ({
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
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data: pilots } = await supabase.from('counties').select('code').eq('is_pilot', true);
  const codes = (pilots ?? []).map((c) => c.code);
  if (codes.length === 0) return [];
  const { data } = await supabase.from('sub_counties').select('id, county_code, name').in('county_code', codes).order('name');
  return data ?? [];
}

export interface PilotCounty extends County {
  focus: [number, number] | null;
}

// County focus points for centring the map. Kept in code because PostgREST
// returns geography as WKB; these match the reference_data migration.
export const COUNTY_FOCUS: Record<number, [number, number]> = {
  22: [36.835, -1.171],
  42: [34.768, -0.092],
  43: [34.457, -0.527],
  44: [34.473, -1.063],
  47: [36.817, -1.286],
};

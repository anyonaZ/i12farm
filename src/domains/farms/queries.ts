import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { FarmDetail } from './types';

const DETAIL_COLUMNS = `
  id, slug, name, farmer_name, description, categories, county_code, place_name, visibility,
  size_acres, year_started, phone_public, whatsapp, verified_at, owner_id, managed_by,
  public_lng, public_lat,
  county:counties(name),
  sub_county:sub_counties(name),
  listings(id, type, product_slug, title, unit, price_kes, quantity, status, product:products(name_en, name_sw, category_slug)),
  media:farm_media(id, storage_path, position)
`;

export async function getFarmBySlug(slug: string): Promise<FarmDetail | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('farms').select(DETAIL_COLUMNS).eq('slug', slug).maybeSingle();
  if (error || !data) return null;
  const farm = data as unknown as FarmDetail;
  farm.listings = (farm.listings ?? [])
    .filter((l) => l.status === 'active' || l.status === 'sold_out')
    .sort((a, b) => (a.price_kes ?? Infinity) - (b.price_kes ?? Infinity));
  farm.media = (farm.media ?? []).sort((a, b) => a.position - b.position);
  return farm;
}

export interface ManagedFarm extends FarmDetail {
  stats: { views: number; calls: number; whatsapps: number };
  history: Record<string, number[]>; // listing id → recent prices, oldest first
}

/** Farms the signed-in user owns or manages as a field agent. */
export async function listManagedFarms(userId: string): Promise<ManagedFarm[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('farms')
    .select(DETAIL_COLUMNS + ', created_at')
    .or(`owner_id.eq.${userId},managed_by.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);
  const farms = (data ?? []) as unknown as FarmDetail[];
  if (farms.length === 0) return [];

  const ids = farms.map((f) => f.id);
  const [{ data: history }, statsRows] = await Promise.all([
    supabase.from('price_history').select('listing_id, price_kes, observed_at').in('farm_id', ids).order('observed_at'),
    Promise.all(farms.map((f) => supabase.rpc('farm_stats', { fid: f.id }).maybeSingle())),
  ]);

  const byListing: Record<string, number[]> = {};
  for (const h of history ?? []) {
    if (h.price_kes === null) continue;
    const list = (byListing[h.listing_id] ??= []);
    if (list.at(-1) !== Number(h.price_kes)) list.push(Number(h.price_kes));
  }

  return farms.map((f, i) => {
    const s = (statsRows[i].data ?? {}) as { views?: number; calls?: number; whatsapps?: number };
    return {
      ...f,
      listings: (f.listings ?? []).filter((l) => l.status !== 'archived'),
      stats: { views: Number(s.views ?? 0), calls: Number(s.calls ?? 0), whatsapps: Number(s.whatsapps ?? 0) },
      history: Object.fromEntries((f.listings ?? []).map((l) => [l.id, (byListing[l.id] ?? []).slice(-5)])),
    };
  });
}

export async function listSavedFarms(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('saved_farms')
    .select('created_at, farm:farms(id, slug, name, place_name, categories, verified_at, county:counties(name))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data ?? [])
    .map((r) => r.farm as unknown as { id: string; slug: string; name: string; place_name: string | null; categories: string[]; verified_at: string | null; county: { name: string } | null } | null)
    .filter((f): f is NonNullable<typeof f> => f !== null);
}

export async function isFarmSaved(farmId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { count } = await supabase
    .from('saved_farms')
    .select('farm_id', { count: 'exact', head: true })
    .eq('farm_id', farmId)
    .eq('user_id', auth.user.id);
  return (count ?? 0) > 0;
}

export async function getPilotProgress() {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc('pilot_progress');
  return (data ?? []) as { county_code: number; county_name: string; farms: number; mine: number }[];
}

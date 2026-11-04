import 'server-only';
import { isDbConfigured, withUser, type Tx } from '@/lib/db';
import { currentUserId } from '@/lib/auth/session';
import type { FarmDetail, FarmSummary } from './types';

// Every read runs as the visitor (anon) or the signed-in user, so RLS decides
// what comes back: drafts, exact locations and other people's data never leak.

function detailQuery(tx: Tx, where: 'slug' | 'managed', value: string, farmId?: string) {
  const filter =
    where === 'slug'
      ? tx`f.slug = ${value}`
      : farmId
        ? tx`(f.owner_id = ${value} or f.managed_by = ${value}) and f.id = ${farmId}`
        : tx`(f.owner_id = ${value} or f.managed_by = ${value})`;
  return tx<FarmDetail[]>`
    select f.id, f.slug, f.name, f.farmer_name, f.description, f.categories, f.county_code, f.place_name,
           f.visibility, f.size_acres, f.year_started, f.phone_public, f.whatsapp,
           f.verified_at::text as verified_at, f.owner_id, f.managed_by,
           public.public_lng(f) as public_lng, public.public_lat(f) as public_lat,
           f.created_at::text as created_at, f.status::text as status,
           json_build_object('name', c.name) as county,
           case when sc.id is null then null else json_build_object('name', sc.name) end as sub_county,
           coalesce((
             select json_agg(json_build_object(
                      'id', l.id, 'type', l.type, 'product_slug', l.product_slug, 'title', l.title, 'unit', l.unit,
                      'price_kes', l.price_kes, 'quantity', l.quantity, 'status', l.status,
                      'product', case when p.slug is null then null
                                      else json_build_object('name_en', p.name_en, 'name_sw', p.name_sw, 'category_slug', p.category_slug) end)
                    order by l.price_kes nulls last, l.created_at)
             from public.listings l left join public.products p on p.slug = l.product_slug
             where l.farm_id = f.id), '[]'::json) as listings,
           coalesce((
             select json_agg(json_build_object('id', m.id, 'storage_path', m.storage_path, 'position', m.position)
                    order by m.position, m.created_at)
             from public.farm_media m where m.farm_id = f.id), '[]'::json) as media,
           (select json_build_object('avg', r.avg_rating, 'count', r.reviews) from public.farm_rating(f.id) r) as rating,
           public.farm_featured(f.id) as featured
    from public.farms f
    join public.counties c on c.code = f.county_code
    left join public.sub_counties sc on sc.id = f.sub_county_id
    where ${filter}
    order by f.created_at desc
    limit 500`;
}

export async function getFarmBySlug(slug: string): Promise<FarmDetail | null> {
  if (!isDbConfigured) return null;
  const userId = await currentUserId();
  const [farm] = await withUser(userId, (tx) => detailQuery(tx, 'slug', slug));
  if (!farm) return null;
  farm.listings = farm.listings.filter((l) => l.status === 'active' || l.status === 'sold_out');
  return farm;
}

export interface ManagedFarm extends FarmDetail {
  stats: { views: number; calls: number; whatsapps: number };
  history: Record<string, number[]>; // listing id → recent prices, oldest first
  balance: { pending: number; due: number; paidOut: number };
  claimed: boolean;
}

/** Farms the signed-in user owns or manages as a field agent. */
export async function listManagedFarms(userId: string, farmId?: string): Promise<ManagedFarm[]> {
  return withUser(userId, async (tx) => {
    const farms = await detailQuery(tx, 'managed', userId, farmId);
    if (farms.length === 0) return [];
    const ids = farms.map((f) => f.id);
    const history = await tx<{ listing_id: string; price_kes: number | null }[]>`
      select listing_id, price_kes from public.price_history where farm_id in ${tx(ids)} order by observed_at`;
    const stats = await tx<{ farm_id: string; views: number; calls: number; whatsapps: number }[]>`
      select f.id as farm_id, s.views, s.calls, s.whatsapps
      from unnest(${ids}::uuid[]) as f(id), lateral public.farm_stats(f.id) s`;
    const balances = await tx<{ farm_id: string; pending_kes: number; due_kes: number; paid_out_kes: number }[]>`
      select f.id as farm_id, b.pending_kes, b.due_kes, b.paid_out_kes
      from unnest(${ids}::uuid[]) as f(id), lateral public.farm_balance(f.id) b`;

    const byListing: Record<string, number[]> = {};
    for (const h of history) {
      if (h.price_kes === null) continue;
      const list = (byListing[h.listing_id] ??= []);
      if (list.at(-1) !== h.price_kes) list.push(h.price_kes);
    }
    return farms.map((f) => {
      const s = stats.find((x) => x.farm_id === f.id);
      const b = balances.find((x) => x.farm_id === f.id);
      return {
        ...f,
        listings: f.listings.filter((l) => l.status !== 'archived'),
        stats: { views: s?.views ?? 0, calls: s?.calls ?? 0, whatsapps: s?.whatsapps ?? 0 },
        history: Object.fromEntries(f.listings.map((l) => [l.id, (byListing[l.id] ?? []).slice(-5)])),
        balance: { pending: b?.pending_kes ?? 0, due: b?.due_kes ?? 0, paidOut: b?.paid_out_kes ?? 0 },
        claimed: f.owner_id !== null,
      };
    });
  });
}

export interface SavedFarm {
  id: string;
  slug: string;
  name: string;
  place_name: string | null;
  categories: string[];
  verified_at: string | null;
  county: { name: string } | null;
}

export async function listSavedFarms(userId: string): Promise<SavedFarm[]> {
  return withUser(
    userId,
    (tx) => tx<SavedFarm[]>`
    select f.id, f.slug, f.name, f.place_name, f.categories, f.verified_at::text as verified_at,
           json_build_object('name', c.name) as county
    from public.saved_farms s
    join public.farms f on f.id = s.farm_id
    join public.counties c on c.code = f.county_code
    where s.user_id = ${userId}
    order by s.created_at desc`,
  );
}

export async function isFarmSaved(farmId: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const [row] = await withUser(
    userId,
    (tx) => tx<{ saved: boolean }[]>`
    select exists (select 1 from public.saved_farms where farm_id = ${farmId} and user_id = ${userId}) as saved`,
  );
  return row?.saved ?? false;
}

export async function getPilotProgress() {
  if (!isDbConfigured) return [];
  const userId = await currentUserId();
  return withUser(
    userId,
    (tx) => tx<{ county_code: number; county_name: string; farms: number; mine: number }[]>`
    select * from public.pilot_progress()`,
  );
}

const SUMMARY_COLUMNS = `id, slug, name, farmer_name, categories, county_code, county_name, place_name, lng, lat,
  verified, cover_path, min_price_kes, min_price_unit, listing_count, rating, review_count, featured`;

export async function farmsInBox(
  userId: string | null,
  box: { west: number; south: number; east: number; north: number },
  category: string | null,
  county: number | null,
): Promise<FarmSummary[]> {
  return withUser(
    userId,
    (tx) => tx<FarmSummary[]>`
    select ${tx.unsafe(SUMMARY_COLUMNS)}
    from public.farms_in_bbox(${box.west}, ${box.south}, ${box.east}, ${box.north},
                              ${category ? [category] : null}::text[], ${county}::smallint, 500)`,
  );
}

export async function searchFarms(
  userId: string | null,
  q: string,
  category: string | null,
  county: number | null,
): Promise<FarmSummary[]> {
  return withUser(
    userId,
    (tx) => tx<FarmSummary[]>`
    select ${tx.unsafe(SUMMARY_COLUMNS)}
    from public.search_farms(${q}, ${category ? [category] : null}::text[], ${county}::smallint, 50)`,
  );
}

export interface FarmReview {
  id: string;
  author_name: string | null;
  rating: number;
  body: string | null;
  created_at: string;
}

export async function listFarmReviews(farmId: string, limit = 10): Promise<FarmReview[]> {
  const userId = await currentUserId();
  return withUser(
    userId,
    (tx) => tx<FarmReview[]>`
    select id, author_name, rating, body, created_at::text as created_at
    from public.reviews where farm_id = ${farmId}
    order by created_at desc limit ${limit}`,
  );
}

export interface ManagedFarmRow {
  id: string;
  slug: string;
  name: string;
  farmer_name: string | null;
  place_name: string | null;
  county_name: string;
  categories: string[];
  status: string;
  claimed: boolean;
  cover_path: string | null;
  products: number;
  need_action: number;
}

/** Light list of every farm the user owns or manages (agents may have hundreds). */
export async function listManagedFarmRows(userId: string): Promise<ManagedFarmRow[]> {
  return withUser(
    userId,
    (tx) => tx<ManagedFarmRow[]>`
    select f.id, f.slug, f.name, f.farmer_name, f.place_name, c.name as county_name, f.categories, f.status::text as status,
           f.owner_id is not null as claimed,
           (select m.storage_path from public.farm_media m where m.farm_id = f.id and m.kind = 'photo'
             order by m.position, m.created_at limit 1) as cover_path,
           (select count(*)::int from public.listings l where l.farm_id = f.id and l.status <> 'archived') as products,
           (select count(*)::int from public.orders o where o.farm_id = f.id and o.status in ('paid', 'accepted')) as need_action
    from public.farms f join public.counties c on c.code = f.county_code
    where f.owner_id = ${userId} or f.managed_by = ${userId}
    order by (select count(*) from public.orders o where o.farm_id = f.id and o.status in ('paid', 'accepted')) desc, f.name`,
  );
}

export interface FarmForEdit {
  id: string;
  slug: string;
  name: string;
  farmer_name: string | null;
  description: string | null;
  categories: string[];
  county_code: number;
  sub_county_id: number | null;
  place_name: string | null;
  visibility: 'exact' | 'approximate' | 'hidden';
  size_acres: number | null;
  year_started: number | null;
  phone_public: string | null;
  whatsapp: string | null;
  status: string;
  lng: number | null;
  lat: number | null;
}

/** A farm the user manages, with its exact pin (RLS: managers only). */
export async function getFarmForEdit(userId: string, farmId: string): Promise<FarmForEdit | null> {
  if (!/^[0-9a-f-]{36}$/.test(farmId)) return null;
  const [row] = await withUser(
    userId,
    (tx) => tx<FarmForEdit[]>`
    select f.id, f.slug, f.name, f.farmer_name, f.description, f.categories, f.county_code, f.sub_county_id, f.place_name,
           f.visibility, f.size_acres, f.year_started, f.phone_public, f.whatsapp, f.status::text as status,
           extensions.st_x(l.location::extensions.geometry) as lng, extensions.st_y(l.location::extensions.geometry) as lat
    from public.farms f left join public.farm_locations l on l.farm_id = f.id
    where f.id = ${farmId} and public.can_manage_farm(f.id)`,
  );
  return row ?? null;
}

import 'server-only';
import { withUser } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

export type VetRequestStatus = 'open' | 'accepted' | 'completed' | 'cancelled' | 'expired';

export interface MyVetRequest {
  id: string;
  number: string;
  status: VetRequestStatus;
  county_name: string;
  place: string | null;
  animal: string;
  description: string | null;
  urgency: 'today' | 'this_week';
  vets_alerted: number;
  vet_name: string | null;
  vet_farm_slug: string | null;
  vet_phone: string | null;
  created_at: string;
}

export interface VetInboxItem {
  id: string;
  number: string;
  status: VetRequestStatus;
  county_code: number;
  county_name: string;
  place: string | null;
  animal: string;
  description: string | null;
  urgency: 'today' | 'this_week';
  contact_name: string | null;
  contact_phone: string | null;
  vet_farm_id: string | null;
  vet_farm_name: string | null;
  created_at: string;
}

export interface VetFarm {
  id: string;
  name: string;
  slug: string;
  county_code: number;
  county_name: string;
  verified: boolean;
  place_name: string | null;
}

export function myVetRequests(viewer: Viewer): Promise<MyVetRequest[]> {
  return withUser(viewer.id, (tx) => tx<MyVetRequest[]>`select *, created_at::text as created_at from public.my_service_requests()`);
}

export function vetInbox(viewer: Viewer): Promise<VetInboxItem[]> {
  return withUser(viewer.id, (tx) => tx<VetInboxItem[]>`select *, created_at::text as created_at from public.vet_requests_for_me()`);
}

/** Vet-service farms the viewer manages (they can take requests for these). */
export function myVetFarms(viewer: Viewer): Promise<VetFarm[]> {
  return withUser(
    viewer.id,
    (tx) => tx<VetFarm[]>`
    select f.id, f.name, f.slug, f.county_code, c.name as county_name, f.verified_at is not null as verified, f.place_name
    from public.farms f join public.counties c on c.code = f.county_code
    where (f.owner_id = ${viewer.id} or f.managed_by = ${viewer.id})
      and f.status = 'published' and 'vet-services' = any (f.categories)
    order by f.name`,
  );
}

/** Public list of vet farms, verified first (for the "Vets on i12farm" strip). */
export function listVetFarms(countyCode: number | null): Promise<VetFarm[]> {
  return withUser(
    null,
    (tx) => tx<VetFarm[]>`
    select f.id, f.name, f.slug, f.county_code, c.name as county_name, f.verified_at is not null as verified, f.place_name
    from public.farms f join public.counties c on c.code = f.county_code
    where f.status = 'published' and 'vet-services' = any (f.categories)
    order by f.county_code = ${countyCode ?? 0} desc, f.verified_at is null, f.name
    limit 12`,
  );
}

/** Counties that have at least one published vet service (listed first in the request form). */
export async function listVetCounties(): Promise<number[]> {
  const rows = await withUser(
    null,
    (tx) => tx<{ county_code: number }[]>`
    select distinct f.county_code from public.farms f
    where f.status = 'published' and 'vet-services' = any (f.categories) and f.county_code is not null`,
  );
  return rows.map((r) => r.county_code);
}

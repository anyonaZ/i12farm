import 'server-only';
import { withUser } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

export interface Plan {
  days: number;
  price: number;
}

export async function listPlans(): Promise<Plan[]> {
  const [row] = await withUser(
    null,
    (tx) => tx<{ value: Plan[] }[]>`
    select value from public.platform_settings where key = 'premium_plans'`,
  );
  return (row?.value ?? []).filter((p) => p.days > 0 && p.price > 0).sort((a, b) => a.days - b.days);
}

export interface PromotionState {
  id: string;
  status: 'awaiting_payment' | 'active' | 'expired' | 'cancelled';
  days: number;
  amount_kes: number;
  starts_at: string | null;
  ends_at: string | null;
  payment: 'requested' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | null;
  payment_desc: string | null;
}

export async function getPromotion(viewer: Viewer, id: string): Promise<PromotionState | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<PromotionState[]>`
    select p.id, p.status, p.days, p.amount_kes, p.starts_at::text as starts_at, p.ends_at::text as ends_at,
           (select x.status::text from public.payments x where x.promotion_id = p.id order by x.requested_at desc limit 1) as payment,
           (select x.result_desc from public.payments x where x.promotion_id = p.id order by x.requested_at desc limit 1) as payment_desc
    from public.farm_promotions p where p.id = ${id}`,
  );
  return row ?? null;
}

/** For My Farm: when each managed farm's featured period ends (null = not featured). */
export async function featuredUntil(viewer: Viewer, farmIds: string[]): Promise<Record<string, string | null>> {
  if (farmIds.length === 0) return {};
  const rows = await withUser(
    viewer.id,
    (tx) => tx<{ farm_id: string; until: string | null }[]>`
    select f.id as farm_id,
           (select max(p.ends_at)::text from public.farm_promotions p
             where p.farm_id = f.id and p.status = 'active' and p.ends_at > now()) as until
    from unnest(${farmIds}::uuid[]) as f(id)`,
  );
  return Object.fromEntries(rows.map((r) => [r.farm_id, r.until]));
}

import 'server-only';
import { withUser } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

// Admin screens. Every function here calls a database function that checks
// the admin role itself, so a bug in a page cannot widen access.

export interface AdminUser {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
  status: 'active' | 'suspended';
  county_code: number | null;
  created_at: string;
  last_sign_in_at: string | null;
  farms: number;
  has_password: boolean;
  has_google: boolean;
}

export async function adminListUsers(viewer: Viewer, q: string): Promise<AdminUser[]> {
  return withUser(
    viewer.id,
    (tx) => tx<AdminUser[]>`
    select id, full_name, email, phone, roles::text[] as roles, status, county_code, created_at::text as created_at,
           last_sign_in_at::text as last_sign_in_at, farms, has_password, has_google
    from public.admin_list_users(${q || null}, 60)`,
  );
}

export async function adminListFarms(viewer: Viewer, onlyUnverified: boolean) {
  return withUser(
    viewer.id,
    (tx) => tx<
      {
        id: string;
        slug: string;
        name: string;
        farmer_name: string | null;
        county_name: string;
        place_name: string | null;
        verified: boolean;
        published_at: string | null;
        managed_by_name: string | null;
        owner_claimed: boolean;
      }[]
    >`
    select id, slug, name, farmer_name, county_name, place_name, verified, published_at::text as published_at, managed_by_name, owner_claimed
    from public.admin_list_farms(${onlyUnverified}, 60)`,
  );
}

export async function adminMoney(viewer: Viewer) {
  return withUser(viewer.id, async (tx) => {
    const payouts = await tx<
      {
        farm_id: string;
        farm_name: string;
        slug: string;
        payout_phone: string | null;
        due_kes: number;
        orders: number;
        oldest_due: string;
      }[]
    >`
      select farm_id, farm_name, slug, payout_phone, due_kes, orders, oldest_due::text as oldest_due from public.admin_payouts_due()`;
    const refunds = await tx<
      { order_id: string; number: string; farm_name: string; buyer_phone: string; due_kes: number; since: string }[]
    >`
      select order_id, number, farm_name, buyer_phone, due_kes, since::text as since from public.admin_refunds_due()`;
    const [totals] = await tx<{ orders: number; paid_orders: number; gmv: number; commission: number }[]>`
      select count(*)::int as orders,
             count(*) filter (where paid_at is not null)::int as paid_orders,
             coalesce(sum(subtotal_kes) filter (where paid_at is not null and status not in ('cancelled', 'declined')), 0) as gmv,
             coalesce(sum(commission_kes) filter (where paid_at is not null and status not in ('cancelled', 'declined')), 0) as commission
      from public.orders`;
    const [setting] = await tx<
      { value: number }[]
    >`select (value #>> '{}')::int as value from public.platform_settings where key = 'commission_bps'`;
    return { payouts, refunds, totals, commissionBps: setting?.value ?? 1000 };
  });
}

import 'server-only';
import { withUser } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

// Admin dashboard numbers. Read as the admin under RLS (admins can read
// orders, ledger, events and contacts); nothing here writes.

export interface Insights {
  days: number;
  kpi: {
    orders: number;
    paid: number;
    gmv: number;
    commission: number;
    promotions: number;
    farms: number;
    people: number;
    views: number;
    contacts: number;
  };
  weekly: { week: string; gmv: number; orders: number }[];
  counties: { county: string; farms: number; contacts: number; paid: number; gmv: number }[];
  products: { title: string; qty: number; value: number }[];
}

export async function getInsights(viewer: Viewer, days: number): Promise<Insights> {
  return withUser(viewer.id, async (tx) => {
    const since = tx`now() - make_interval(days => ${days})`;
    const [kpi] = await tx<Insights['kpi'][]>`
      select
        (select count(*)::int from public.orders where created_at >= ${since}) as orders,
        (select count(*)::int from public.orders where paid_at >= ${since}) as paid,
        (select coalesce(sum(subtotal_kes), 0) from public.orders
          where paid_at >= ${since} and status not in ('cancelled', 'declined')) as gmv,
        (select coalesce(sum(commission_kes), 0) from public.orders
          where paid_at >= ${since} and status not in ('cancelled', 'declined')) as commission,
        (select coalesce(sum(amount_kes), 0) from public.ledger_entries
          where kind = 'promotion_fee' and created_at >= ${since}) as promotions,
        (select count(*)::int from public.farms where status = 'published') as farms,
        (select count(*)::int from public.profiles where created_at >= ${since}) as people,
        (select count(*)::int from public.events where name = 'farm.viewed' and occurred_at >= ${since}) as views,
        (select count(*)::int from public.contact_events where channel in ('call', 'whatsapp') and created_at >= ${since}) as contacts`;

    const weekly = await tx<Insights['weekly']>`
      with weeks as (
        select generate_series(
          date_trunc('week', (now() at time zone 'Africa/Nairobi') - interval '11 weeks'),
          date_trunc('week', now() at time zone 'Africa/Nairobi'),
          interval '1 week') as week
      )
      select to_char(w.week, 'YYYY-MM-DD') as week,
             coalesce(sum(o.subtotal_kes), 0) as gmv,
             count(o.id)::int as orders
      from weeks w
      left join public.orders o
        on date_trunc('week', o.paid_at at time zone 'Africa/Nairobi') = w.week
       and o.status not in ('cancelled', 'declined')
      group by w.week
      order by w.week`;

    const counties = await tx<Insights['counties']>`
      select c.name as county,
             (select count(*)::int from public.farms f where f.county_code = c.code and f.status = 'published') as farms,
             (select count(*)::int from public.contact_events e where e.county_code = c.code and e.created_at >= ${since}) as contacts,
             (select count(*)::int from public.orders o where o.county_code = c.code and o.paid_at >= ${since}) as paid,
             (select coalesce(sum(o.subtotal_kes), 0) from public.orders o
               where o.county_code = c.code and o.paid_at >= ${since} and o.status not in ('cancelled', 'declined')) as gmv
      from public.counties c
      where c.is_pilot
      order by gmv desc, farms desc, c.name`;

    const products = await tx<Insights['products']>`
      select coalesce(p.name_en, i.title) as title, sum(i.quantity)::int as qty, sum(i.line_total_kes) as value
      from public.order_items i
      join public.orders o on o.id = i.order_id
      left join public.products p on p.slug = i.product_slug
      where o.paid_at >= ${since} and o.status not in ('cancelled', 'declined')
      group by 1
      order by value desc
      limit 8`;

    return { days, kpi, weekly, counties, products };
  });
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Quote, and defuse spreadsheet formulas (=, +, -, @ at the start).
  const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

export const EXPORTS = {
  orders: {
    columns: [
      'number',
      'created_at',
      'paid_at',
      'completed_at',
      'status',
      'county',
      'farm',
      'fulfilment',
      'visit_date',
      'subtotal_kes',
      'commission_kes',
      'farmer_payout_kes',
      'items',
    ],
    query: (viewer: Viewer) =>
      withUser(
        viewer.id,
        (tx) => tx`
        select o.number, o.created_at, o.paid_at, o.completed_at, o.status, c.name as county, f.name as farm, o.fulfilment,
               o.visit_date, o.subtotal_kes, o.commission_kes, o.farmer_payout_kes,
               (select string_agg(i.quantity || ' x ' || i.title, '; ') from public.order_items i where i.order_id = o.id) as items
        from public.orders o join public.counties c on c.code = o.county_code left join public.farms f on f.id = o.farm_id
        order by o.created_at desc limit 50000`,
      ),
  },
  contacts: {
    columns: ['created_at', 'farm', 'county', 'channel', 'signed_in'],
    query: (viewer: Viewer) =>
      withUser(
        viewer.id,
        (tx) => tx`
        select e.created_at, f.name as farm, c.name as county, e.channel, e.actor_id is not null as signed_in
        from public.contact_events e join public.farms f on f.id = e.farm_id left join public.counties c on c.code = e.county_code
        order by e.created_at desc limit 50000`,
      ),
  },
  daily: {
    columns: ['day', 'name', 'county_code', 'events', 'actors'],
    query: (viewer: Viewer) =>
      withUser(
        viewer.id,
        (tx) => tx`select day, name, county_code, events, actors from public.events_daily order by day desc, name limit 100000`,
      ),
  },
  payouts: {
    columns: ['farm_id', 'farm_name', 'mpesa_phone', 'amount_kes', 'reference'],
    query: (viewer: Viewer) =>
      withUser(
        viewer.id,
        (tx) => tx`
        select farm_id, farm_name, regexp_replace(coalesce(payout_phone, ''), '\\D', '', 'g') as mpesa_phone,
               round(due_kes)::int as amount_kes, '' as reference
        from public.admin_payouts_due()`,
      ),
  },
} as const;

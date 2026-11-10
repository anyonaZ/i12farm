import 'server-only';
import { withUser } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';
import type { OrderDetail, OrderSummary } from './types';

// Orders are read as the signed-in user; RLS limits them to the buyer, the
// farm's managers and admins.

export async function getOrder(viewer: Viewer, number: string): Promise<OrderDetail | null> {
  if (!/^[0-9A-F]{6,8}$/.test(number)) return null;
  const [order] = await withUser(
    viewer.id,
    (tx) => tx<OrderDetail[]>`
    select o.id, o.number, o.status, o.subtotal_kes, o.created_at::text as created_at, o.fulfilment, o.buyer_name,
           o.delivery_note, o.visit_date::text as visit_date, o.visit_slot, o.buyer_phone, o.commission_bps, o.commission_kes, o.farmer_payout_kes, o.collection_fee_kes,
           o.paid_at::text as paid_at, o.completed_at::text as completed_at,
           f.name as farm_name, f.slug as farm_slug,
           (select count(*)::int from public.order_items i where i.order_id = o.id) as item_count,
           o.buyer_id = ${viewer.id} as i_am_buyer,
           public.can_manage_farm(o.farm_id) as i_manage,
           case when f.id is null then null else json_build_object(
             'id', f.id, 'name', f.name, 'slug', f.slug, 'phone', f.phone_public, 'whatsapp', f.whatsapp, 'place', f.place_name) end as farm,
           coalesce((select json_agg(json_build_object(
                       'id', i.id, 'title', i.title, 'unit', i.unit, 'product_slug', i.product_slug,
                       'unit_price_kes', i.unit_price_kes, 'quantity', i.quantity, 'line_total_kes', i.line_total_kes) order by i.title)
                     from public.order_items i where i.order_id = o.id), '[]'::json) as items,
           coalesce((select json_agg(json_build_object(
                       'from', h.from_status, 'to', h.to_status, 'note', h.note, 'at', h.at, 'by_system', h.actor_id is null) order by h.at, h.id)
                     from public.order_status_history h where h.order_id = o.id), '[]'::json) as history,
           coalesce((select json_agg(json_build_object(
                       'id', p.id, 'status', p.status, 'amount', p.amount_kes, 'receipt', p.mpesa_receipt,
                       'requested_at', p.requested_at, 'result_desc', p.result_desc) order by p.requested_at desc)
                     from public.payments p where p.order_id = o.id), '[]'::json) as payments,
           (select json_build_object('rating', r.rating, 'body', r.body) from public.reviews r where r.order_id = o.id) as review
    from public.orders o
    left join public.farms f on f.id = o.farm_id
    where o.number = ${number}`,
  );
  return order ?? null;
}

/** Orders I placed as a buyer, or orders for farms I manage. */
export async function listOrders(viewer: Viewer, side: 'buyer' | 'farm', limit = 50): Promise<OrderSummary[]> {
  return withUser(viewer.id, (tx) => {
    const filter = side === 'buyer' ? tx`o.buyer_id = ${viewer.id}` : tx`public.can_manage_farm(o.farm_id) and o.buyer_id <> ${viewer.id}`;
    return tx<OrderSummary[]>`
      select o.id, o.number, o.status, o.subtotal_kes, o.created_at::text as created_at, o.fulfilment, o.buyer_name,
             f.name as farm_name, f.slug as farm_slug,
             (select count(*)::int from public.order_items i where i.order_id = o.id) as item_count
      from public.orders o
      left join public.farms f on f.id = o.farm_id
      where ${filter}
      order by o.created_at desc
      limit ${limit}`;
  });
}

/** Counts that need the farm's attention (paid, waiting to be accepted or made ready). */
export async function farmOrdersNeedingAction(viewer: Viewer): Promise<number> {
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<{ n: number }[]>`
    select count(*)::int as n from public.orders o
    where public.can_manage_farm(o.farm_id) and o.buyer_id <> ${viewer.id} and o.status in ('paid', 'accepted')`,
  );
  return row?.n ?? 0;
}

/** Live listings of a farm, for checkout. */
export async function farmForCheckout(viewer: Viewer | null, slug: string) {
  const [farm] = await withUser(
    viewer?.id ?? null,
    (tx) => tx<
      {
        id: string;
        slug: string;
        name: string;
        farmer_name: string | null;
        place_name: string | null;
        county_name: string;
        mine: boolean;
        listings: {
          id: string;
          title: string;
          unit: string;
          price_kes: number;
          quantity: number | null;
          product_slug: string | null;
          type: string;
        }[];
      }[]
    >`
    select f.id, f.slug, f.name, f.farmer_name, f.place_name, c.name as county_name,
           public.can_manage_farm(f.id) as mine,
           coalesce((select json_agg(json_build_object('id', l.id, 'title', l.title, 'unit', l.unit, 'price_kes', l.price_kes, 'type', l.type,
                                                       'quantity', l.quantity, 'product_slug', l.product_slug) order by l.price_kes)
                     from public.listings l where l.farm_id = f.id and l.status = 'active' and l.price_kes is not null), '[]'::json) as listings
    from public.farms f join public.counties c on c.code = f.county_code
    where f.slug = ${slug} and f.status = 'published'`,
  );
  return farm ?? null;
}

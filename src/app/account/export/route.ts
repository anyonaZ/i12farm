import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSql, withUser } from '@/lib/db';

// Account → Download my data: everything we hold about the signed-in person,
// as one JSON file (Data Protection Act 2019: right of access).
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  const [account] = await getSql()`
    select u.email, u.phone, u.created_at, u.last_sign_in_at, u.email_verified_at,
           (select coalesce(json_agg(i.provider), '[]') from auth.identities i where i.user_id = u.id) as sign_in_with,
           (select coalesce(json_agg(json_build_object('started', s.created_at, 'last_seen', s.last_seen_at, 'device', s.user_agent,
                                                       'ended', s.revoked_at) order by s.created_at desc), '[]')
              from auth.sessions s where s.user_id = u.id) as sessions
    from auth.users u where u.id = ${viewer.id}`;
  const data = await withUser(viewer.id, async (tx) => {
    const [profile] = await tx`select full_name, phone, roles::text[] as roles, county_code, preferred_language, organisation,
                                      consent_version, consent_at, created_at from public.profiles where id = ${viewer.id}`;
    const farms = await tx`
      select f.id, f.name, f.farmer_name, f.description, f.categories, f.county_code, f.place_name, f.phone_public, f.whatsapp,
             f.status, f.created_at, f.owner_id = ${viewer.id} as i_own_it,
             (select json_build_object('lng', extensions.st_x(l.location::extensions.geometry), 'lat', extensions.st_y(l.location::extensions.geometry))
                from public.farm_locations l where l.farm_id = f.id) as exact_location,
             (select coalesce(json_agg(json_build_object('title', x.title, 'unit', x.unit, 'price_kes', x.price_kes,
                                                         'quantity', x.quantity, 'status', x.status)), '[]')
                from public.listings x where x.farm_id = f.id) as products
      from public.farms f where f.owner_id = ${viewer.id} or f.managed_by = ${viewer.id}`;
    const orders = await tx`
      select o.number, o.status, o.subtotal_kes, o.buyer_name, o.buyer_phone, o.delivery_note, o.created_at, o.paid_at,
             (select coalesce(json_agg(json_build_object('title', i.title, 'quantity', i.quantity, 'unit_price_kes', i.unit_price_kes)), '[]')
                from public.order_items i where i.order_id = o.id) as items
      from public.orders o where o.buyer_id = ${viewer.id} order by o.created_at desc`;
    const messages = await tx`select m.body, m.created_at from public.messages m where m.sender_id = ${viewer.id} order by m.id`;
    const reviews = await tx`select r.rating, r.body, r.created_at from public.reviews r where r.author_id = ${viewer.id}`;
    const vetRequests = await tx`select number, status, animal, place, description, vet_name, created_at from public.my_service_requests()`;
    const saved = await tx`select f.name from public.saved_farms s join public.farms f on f.id = s.farm_id where s.user_id = ${viewer.id}`;
    return { profile, farms, orders, messages, reviews, vet_requests: vetRequests, saved_farms: saved };
  });
  const body = JSON.stringify({ exported_at: new Date().toISOString(), account, ...data }, null, 2);
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="i12farm-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}

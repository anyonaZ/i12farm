'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, withUser } from '@/lib/db';
import { isKenyanMobile, normalisePhone } from '@/lib/phone';
import type { NewFarmPayload, Visibility } from './types';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

export async function createFarm(input: NewFarmPayload): Promise<Result<{ id: string; slug: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signed out' };
  const name = input.name?.trim();
  if (!name || name.length < 2) return { ok: false, error: 'farm name missing' };
  if (!input.categories?.length) return { ok: false, error: 'no category' };
  if (!isKenyanMobile(input.phone ?? '')) return { ok: false, error: 'invalid phone number' };
  const listings = (input.listings ?? []).filter((l) => l.product_slug && Number(l.price_kes) > 0).slice(0, 20);
  if (listings.length === 0) return { ok: false, error: 'no priced product' };

  try {
    const created = await withUser(viewer.id, async (tx) => {
      const payload = {
        ...input,
        name,
        phone: normalisePhone(input.phone),
        listings: listings.map((l) => ({
          product_slug: l.product_slug,
          price_kes: Math.round(Number(l.price_kes)),
          quantity: l.quantity ? Math.round(Number(l.quantity)) : null,
        })),
      };
      const [row] = await tx<{ id: string; slug: string }[]>`select * from public.create_farm(${tx.json(payload as never)})`;
      await recordEvent(tx, {
        name: 'farm.published',
        userId: viewer.id,
        countyCode: input.county_code,
        properties: {
          farm: row.id,
          by: input.for_farmer ? 'agent' : 'farmer',
          visibility: input.visibility,
          categories: input.categories.join('|'),
          listings: listings.length,
        },
        path: '/my-farm/new',
      });
      return row;
    });
    revalidatePath('/');
    revalidatePath('/my-farm');
    return { ok: true, data: created };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
}

export async function updateListingPrice(listingId: string, price: number): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signed out' };
  const value = Math.round(Number(price));
  if (!(value > 0)) return { ok: false, error: 'price must be above zero' };
  try {
    const [row] = await withUser(viewer.id, async (tx) => {
      const rows = await tx<{ farm_id: string; product_slug: string | null }[]>`
        update public.listings set price_kes = ${value} where id = ${listingId} returning farm_id, product_slug`;
      if (rows[0]) {
        await recordEvent(tx, {
          name: 'listing.price_changed',
          userId: viewer.id,
          properties: { farm: rows[0].farm_id, product: rows[0].product_slug, price: value },
          path: '/my-farm',
        });
      }
      return rows;
    });
    if (!row) return { ok: false, error: 'not allowed' };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
  revalidatePath('/my-farm');
  return { ok: true, data: undefined };
}

/** Restock or change the quantity on offer; 0 marks it sold out, a number above 0 reactivates it. */
export async function updateListingQuantity(listingId: string, quantity: number | null): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signed out' };
  const qty = quantity === null ? null : Math.max(0, Math.round(Number(quantity)));
  try {
    const rows = await withUser(
      viewer.id,
      (tx) => tx`
      update public.listings
         set quantity = ${qty},
             status = case when ${qty}::numeric = 0 then 'sold_out'::public.listing_status
                           when status = 'sold_out' then 'active'::public.listing_status
                           else status end
       where id = ${listingId}
       returning id`,
    );
    if (rows.length === 0) return { ok: false, error: 'not allowed' };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
  revalidatePath('/my-farm');
  return { ok: true, data: undefined };
}

export async function setFarmVisibility(farmId: string, visibility: Visibility): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signed out' };
  if (!['exact', 'approximate', 'hidden'].includes(visibility)) return { ok: false, error: 'bad visibility' };
  try {
    const rows = await withUser(
      viewer.id,
      (tx) => tx`update public.farms set visibility = ${visibility} where id = ${farmId} returning id`,
    );
    if (rows.length === 0) return { ok: false, error: 'not allowed' };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
  revalidatePath('/my-farm');
  revalidatePath('/');
  return { ok: true, data: undefined };
}

export async function toggleSavedFarm(farmId: string): Promise<Result<{ saved: boolean }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signed out' };
  try {
    const saved = await withUser(viewer.id, async (tx) => {
      const removed = await tx`delete from public.saved_farms where farm_id = ${farmId} and user_id = ${viewer.id} returning farm_id`;
      const nowSaved = removed.length === 0;
      if (nowSaved) await tx`insert into public.saved_farms (farm_id) values (${farmId})`;
      await recordEvent(tx, { name: 'farm.saved', userId: viewer.id, properties: { farm: farmId, saved: nowSaved } });
      return nowSaved;
    });
    revalidatePath('/my-farm');
    return { ok: true, data: { saved } };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
}

/** Field agent: a one-time code the farmer enters to take ownership of an enrolled farm. */
export async function issueClaimCode(farmId: string): Promise<Result<{ code: string; expires: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signed out' };
  try {
    const row = await withUser(viewer.id, async (tx) => {
      const [r] = await tx<{ code: string; expires_at: Date }[]>`select * from public.issue_claim_code(${farmId})`;
      await recordEvent(tx, { name: 'farm.claim_code_issued', userId: viewer.id, properties: { farm: farmId }, path: '/my-farm' });
      return r;
    });
    return { ok: true, data: { code: row.code, expires: row.expires_at.toISOString() } };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Editing a published farm (Phase 3.5). RLS and column grants decide who may
// change what; these actions only validate and tidy the input.
// ---------------------------------------------------------------------------

export interface FarmEditInput {
  name: string;
  farmerName: string;
  description: string;
  categories: string[];
  countyCode: number;
  subCountyId: number | null;
  placeName: string;
  phone: string;
  whatsapp: string;
  sizeAcres: string;
  yearStarted: string;
  visibility: Visibility;
  lng: number | null;
  lat: number | null;
}

export async function updateFarm(farmId: string, input: FarmEditInput): Promise<Result<{ slug: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'name' };
  if (!input.categories.length) return { ok: false, error: 'categories' };
  const phone = input.phone.trim() ? normalisePhone(input.phone) : null;
  const whatsapp = input.whatsapp.trim() ? normalisePhone(input.whatsapp) : null;
  if ((input.phone.trim() && !phone) || (input.whatsapp.trim() && !whatsapp)) return { ok: false, error: 'phone' };
  if (!['exact', 'approximate', 'hidden'].includes(input.visibility)) return { ok: false, error: 'visibility' };
  const size = input.sizeAcres.trim() ? Number(input.sizeAcres) : null;
  const year = input.yearStarted.trim() ? Math.round(Number(input.yearStarted)) : null;
  if (size !== null && !(size > 0 && size < 100000)) return { ok: false, error: 'size' };
  if (year !== null && !(year >= 1900 && year <= new Date().getFullYear())) return { ok: false, error: 'year' };
  const moved = input.lng !== null && input.lat !== null;
  if (moved && !(input.lng! >= 33.5 && input.lng! <= 42 && input.lat! >= -5 && input.lat! <= 5.5)) return { ok: false, error: 'pin' };
  try {
    const slug = await withUser(viewer.id, async (tx) => {
      const [row] = await tx<{ slug: string }[]>`
        update public.farms
           set name = ${name}, farmer_name = ${input.farmerName.trim() || null}, description = ${input.description.trim().slice(0, 2000) || null},
               categories = ${input.categories}, county_code = ${input.countyCode}, sub_county_id = ${input.subCountyId},
               place_name = ${input.placeName.trim().slice(0, 120) || null}, phone_public = ${phone}, whatsapp = ${whatsapp},
               size_acres = ${size}, year_started = ${year}, visibility = ${input.visibility}
         where id = ${farmId}
         returning slug`;
      if (!row) throw Object.assign(new Error('Not your farm'), { code: '42501' });
      if (moved) {
        await tx`
          insert into public.farm_locations (farm_id, location, source)
          values (${farmId}, extensions.st_setsrid(extensions.st_makepoint(${input.lng}, ${input.lat}), 4326)::extensions.geography, 'pin')
          on conflict (farm_id) do update set location = excluded.location`;
      }
      return row.slug;
    });
    revalidatePath('/my-farm');
    revalidatePath(`/f/${slug}`);
    revalidatePath('/');
    return { ok: true, data: { slug } };
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
}

/** Pause (hide from Explore and search) or publish again. Suspension stays an admin decision. */
export async function setFarmPublished(farmId: string, published: boolean): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  try {
    const rows = await withUser(
      viewer.id,
      (tx) =>
        tx`update public.farms set status = ${published ? 'published' : 'draft'} where id = ${farmId} and status <> 'suspended' returning id`,
    );
    if (!rows.length) return { ok: false, error: 'notAllowed' };
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
  revalidatePath('/my-farm');
  revalidatePath('/');
  return { ok: true, data: undefined };
}

/** Pause, resume or remove a product. Removed products are archived, so past orders keep their link. */
export async function setListingStatus(listingId: string, status: 'active' | 'paused' | 'archived'): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  if (!['active', 'paused', 'archived'].includes(status)) return { ok: false, error: 'status' };
  try {
    const rows = await withUser(
      viewer.id,
      (tx) => tx`update public.listings set status = ${status}::public.listing_status where id = ${listingId} returning id`,
    );
    if (!rows.length) return { ok: false, error: 'notAllowed' };
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
  revalidatePath('/my-farm', 'layout');
  return { ok: true, data: undefined };
}

export interface NewListingInput {
  productSlug: string;
  title: string;
  price: string;
  quantity: string;
}

export async function addListing(farmId: string, input: NewListingInput): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const price = input.price.trim() ? Math.round(Number(input.price)) : null;
  const qty = input.quantity.trim() ? Math.max(0, Math.round(Number(input.quantity))) : null;
  if (price !== null && !(price > 0 && price < 10_000_000)) return { ok: false, error: 'price' };
  try {
    await withUser(viewer.id, async (tx) => {
      const rows = await tx`
        insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity)
        select ${farmId},
               (case when p.category_slug = 'vet-services' then 'service'
                     when p.category_slug = 'training' then 'experience'
                     when p.default_unit in ('head', 'bird', 'chick') then 'livestock'
                     when p.category_slug = 'inputs' then 'input'
                     else 'produce' end)::public.listing_type,
               p.slug, coalesce(nullif(${input.title.trim().slice(0, 100)}, ''), p.name_en), p.default_unit, ${price}, ${qty}
        from public.products p where p.slug = ${input.productSlug}
        returning id`;
      if (!rows.length) throw Object.assign(new Error('Unknown product'), { code: '22023' });
      await recordEvent(tx, {
        name: 'listing.created',
        userId: viewer.id,
        properties: { farm: farmId, product: input.productSlug },
        path: '/my-farm',
      });
    });
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
  revalidatePath('/my-farm', 'layout');
  return { ok: true, data: undefined };
}

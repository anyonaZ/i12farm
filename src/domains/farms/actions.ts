'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, withUser } from '@/lib/db';
import { isKenyanMobile, normalisePhone } from '@/lib/phone';
import type { NewFarmPayload, Visibility } from './types';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

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

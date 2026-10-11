'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isKenyanMobile, normalisePhone } from '@/lib/phone';
import type { NewFarmPayload, Visibility } from './types';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export async function createFarm(input: NewFarmPayload): Promise<Result<{ id: string; slug: string }>> {
  const name = input.name?.trim();
  if (!name || name.length < 2) return { ok: false, error: 'farm name missing' };
  if (!input.categories?.length) return { ok: false, error: 'no category' };
  if (!isKenyanMobile(input.phone ?? '')) return { ok: false, error: 'invalid phone number' };
  const listings = (input.listings ?? []).filter((l) => l.product_slug && Number(l.price_kes) > 0).slice(0, 20);
  if (listings.length === 0) return { ok: false, error: 'no priced product' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc('create_farm', {
      payload: {
        ...input,
        name,
        phone: normalisePhone(input.phone),
        listings: listings.map((l) => ({
          product_slug: l.product_slug,
          price_kes: Math.round(Number(l.price_kes)),
          quantity: l.quantity ? Math.round(Number(l.quantity)) : null,
        })),
      },
    })
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'unknown error' };

  const created = data as { id: string; slug: string };
  await supabase.from('events').insert({
    name: 'farm.published',
    user_id: (await supabase.auth.getUser()).data.user?.id,
    county_code: input.county_code,
    properties: {
      farm: created.id,
      by: input.for_farmer ? 'agent' : 'farmer',
      visibility: input.visibility,
      categories: input.categories.join('|'),
      listings: listings.length,
    },
    path: '/my-farm/new',
  });

  revalidatePath('/');
  revalidatePath('/my-farm');
  return { ok: true, data: created };
}

/** Called after the browser has uploaded photos straight to Storage. */
export async function attachFarmMedia(
  farmId: string,
  photos: { path: string; width: number; height: number; bytes: number }[],
): Promise<Result> {
  const supabase = await createClient();
  const rows = photos.slice(0, 4).map((p, i) => ({
    farm_id: farmId,
    storage_path: p.path,
    kind: 'photo',
    position: i,
    width: p.width,
    height: p.height,
    bytes: p.bytes,
  }));
  const { error } = await supabase.from('farm_media').insert(rows);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true, data: undefined };
}

export async function updateListingPrice(listingId: string, price: number): Promise<Result> {
  const value = Math.round(Number(price));
  if (!(value > 0)) return { ok: false, error: 'price must be above zero' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('listings')
    .update({ price_kes: value })
    .eq('id', listingId)
    .select('farm_id, product_slug')
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? 'not allowed' };
  await supabase.from('events').insert({
    name: 'listing.price_changed',
    user_id: (await supabase.auth.getUser()).data.user?.id,
    properties: { farm: data.farm_id, product: data.product_slug, price: value },
    path: '/my-farm',
  });
  revalidatePath('/my-farm');
  return { ok: true, data: undefined };
}

export async function setFarmVisibility(farmId: string, visibility: Visibility): Promise<Result> {
  if (!['exact', 'approximate', 'hidden'].includes(visibility)) return { ok: false, error: 'bad visibility' };
  const supabase = await createClient();
  const { error } = await supabase.from('farms').update({ visibility }).eq('id', farmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/my-farm');
  revalidatePath('/');
  return { ok: true, data: undefined };
}

export async function toggleSavedFarm(farmId: string): Promise<Result<{ saved: boolean }>> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'signed out' };
  const { count } = await supabase
    .from('saved_farms')
    .select('farm_id', { count: 'exact', head: true })
    .eq('farm_id', farmId)
    .eq('user_id', auth.user.id);
  const saved = (count ?? 0) === 0;
  const { error } = saved
    ? await supabase.from('saved_farms').insert({ farm_id: farmId })
    : await supabase.from('saved_farms').delete().eq('farm_id', farmId).eq('user_id', auth.user.id);
  if (error) return { ok: false, error: error.message };
  await supabase.from('events').insert({ name: 'farm.saved', user_id: auth.user.id, properties: { farm: farmId, saved } });
  revalidatePath('/my-farm');
  return { ok: true, data: { saved } };
}

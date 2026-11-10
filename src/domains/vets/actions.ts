'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, withUser } from '@/lib/db';
import { toInternational } from '@/lib/phone';
import { kickPush } from '@/lib/push';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

export interface VetRequestInput {
  countyCode: number;
  place: string;
  animal: string;
  description: string;
  urgency: 'today' | 'this_week';
  phone: string;
}

export async function requestVet(input: VetRequestInput): Promise<Result<{ number: string; vets: number }>> {
  kickPush();
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const phone = toInternational(input.phone) ?? viewer.phone ?? toInternational(viewer.contactPhone);
  if (!phone) return { ok: false, error: 'phone' };
  try {
    const row = await withUser(viewer.id, async (tx) => {
      const [r] = await tx<{ id: string; number: string; vets_alerted: number }[]>`
        select * from public.request_vet(${tx.json({
          county_code: input.countyCode,
          place: input.place.slice(0, 120),
          animal: input.animal,
          description: input.description.slice(0, 500),
          urgency: input.urgency,
          contact_phone: phone,
          contact_name: viewer.fullName ?? '',
        })})`;
      await recordEvent(tx, {
        name: 'vet.requested',
        userId: viewer.id,
        properties: { via: 'web', animal: input.animal, vets: r.vets_alerted },
        countyCode: input.countyCode,
        path: '/vets',
      });
      return r;
    });
    revalidatePath('/vets');
    return { ok: true, data: { number: row.number, vets: row.vets_alerted } };
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
}

export async function acceptVetRequest(requestId: string, vetFarmId: string): Promise<Result> {
  kickPush();
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  try {
    await withUser(viewer.id, async (tx) => {
      await tx`select public.accept_service_request(${requestId}, ${vetFarmId})`;
      await recordEvent(tx, { name: 'vet.accepted', userId: viewer.id, properties: { request: requestId, via: 'web' }, path: '/vets' });
    });
  } catch (error) {
    const e = error as { code?: string };
    return { ok: false, error: e.code === '55000' ? 'taken' : 'failed', detail: dbMessage(error) };
  }
  revalidatePath('/vets');
  return { ok: true, data: undefined };
}

export async function closeVetRequest(requestId: string, outcome: 'completed' | 'cancelled'): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  try {
    await withUser(viewer.id, async (tx) => {
      await tx`select public.close_service_request(${requestId}, ${outcome})`;
      await recordEvent(tx, { name: 'vet.closed', userId: viewer.id, properties: { request: requestId, outcome }, path: '/vets' });
    });
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
  revalidatePath('/vets');
  return { ok: true, data: undefined };
}

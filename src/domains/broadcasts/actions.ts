'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, withUser } from '@/lib/db';
import { dispatchSoon } from '@/domains/notifications/dispatch';
import { audience as loadAudience, type Audience } from './queries';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

async function partner() {
  const viewer = await getViewer();
  return viewer && (viewer.roles.includes('partner') || viewer.roles.includes('admin')) ? viewer : null;
}

export async function previewAudience(counties: number[], categories: string[], verifiedOnly: boolean): Promise<Result<Audience>> {
  const viewer = await partner();
  if (!viewer) return { ok: false, error: 'partnersOnly' };
  try {
    return { ok: true, data: await loadAudience(viewer, counties.map(Number), categories, verifiedOnly) };
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
}

export interface BroadcastInput {
  organisation: string;
  bodyEn: string;
  bodySw: string;
  counties: number[];
  categories: string[];
  verifiedOnly: boolean;
}

export async function createBroadcast(input: BroadcastInput): Promise<Result<{ id: string }>> {
  const viewer = await partner();
  if (!viewer) return { ok: false, error: 'partnersOnly' };
  try {
    const id = await withUser(viewer.id, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        select public.create_broadcast(${tx.json({
          organisation: input.organisation,
          body_en: input.bodyEn,
          body_sw: input.bodySw,
          counties: input.counties.map(Number),
          categories: input.categories,
          verified_only: input.verifiedOnly,
        })}) as id`;
      await tx`update public.profiles set organisation = ${input.organisation.trim().slice(0, 120)} where id = ${viewer.id}`;
      await recordEvent(tx, { name: 'broadcast.created', userId: viewer.id, properties: { broadcast: row.id }, path: '/partner' });
      return row.id;
    });
    revalidatePath('/partner');
    revalidatePath('/admin');
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
}

export async function withdrawBroadcast(id: string): Promise<Result> {
  const viewer = await partner();
  if (!viewer) return { ok: false, error: 'partnersOnly' };
  try {
    await withUser(viewer.id, (tx) => tx`select public.cancel_broadcast(${id})`);
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
  revalidatePath('/partner');
  return { ok: true, data: undefined };
}

export async function reviewBroadcast(id: string, approve: boolean, note: string): Promise<Result<{ recipients: number }>> {
  const viewer = await getViewer();
  if (!viewer?.roles.includes('admin')) return { ok: false, error: 'adminsOnly' };
  try {
    const recipients = await withUser(viewer.id, async (tx) => {
      const [row] = await tx<{ n: number }[]>`select public.admin_review_broadcast(${id}, ${approve}, ${note.slice(0, 500) || null}) as n`;
      await recordEvent(tx, {
        name: 'broadcast.reviewed',
        userId: viewer.id,
        properties: { broadcast: id, approve, recipients: row.n },
        path: '/admin',
      });
      return row.n;
    });
    dispatchSoon();
    revalidatePath('/admin');
    return { ok: true, data: { recipients } };
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
}

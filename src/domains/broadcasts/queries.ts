import 'server-only';
import { withUser, type Tx } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

export type BroadcastStatus = 'pending_review' | 'approved' | 'rejected' | 'cancelled' | 'sent';

export interface Broadcast {
  id: string;
  organisation: string;
  body_en: string;
  body_sw: string;
  counties: number[];
  categories: string[];
  verified_only: boolean;
  status: BroadcastStatus;
  estimated_recipients: number;
  recipients: number | null;
  review_note: string | null;
  created_at: string;
  sent_at: string | null;
  author: string | null;
  stats: { queued: number; sent: number; delivered: number; failed: number; skipped: number; cost_kes: number } | null;
}

const COLUMNS = (tx: Tx) => tx`
  b.id, b.organisation, b.body_en, b.body_sw, b.counties, b.categories, b.verified_only, b.status, b.estimated_recipients,
  b.recipients, b.review_note, b.created_at::text as created_at, b.sent_at::text as sent_at,
  (select coalesce(p.full_name, '') from public.profiles p where p.id = b.created_by) as author,
  case when b.status = 'sent' then public.broadcast_stats(b.id) end as stats`;

/** The viewer's own broadcasts (RLS: authors and admins). */
export function myBroadcasts(viewer: Viewer): Promise<Broadcast[]> {
  return withUser(
    viewer.id,
    (tx) =>
      tx<Broadcast[]>`select ${COLUMNS(tx)} from public.broadcasts b where b.created_by = ${viewer.id} order by b.created_at desc limit 30`,
  );
}

/** Admin: waiting for review first, then recent. */
export function allBroadcasts(viewer: Viewer): Promise<Broadcast[]> {
  return withUser(
    viewer.id,
    (tx) =>
      tx<Broadcast[]>`select ${COLUMNS(tx)} from public.broadcasts b order by b.status <> 'pending_review', b.created_at desc limit 30`,
  );
}

export interface Audience {
  phones: number;
  opted_out: number;
  reach: number;
  cost_kes: number;
  max: number;
}

export async function audience(viewer: Viewer, counties: number[], categories: string[], verifiedOnly: boolean): Promise<Audience> {
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<{ a: Audience }[]>`select public.broadcast_audience(${counties}::smallint[], ${categories}::text[], ${verifiedOnly}) as a`,
  );
  return row.a;
}

export async function myOrganisation(viewer: Viewer): Promise<string> {
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<{ organisation: string | null }[]>`select organisation from public.profiles where id = ${viewer.id}`,
  );
  return row?.organisation ?? '';
}

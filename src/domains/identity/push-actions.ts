'use server';

import { getViewer } from '@/lib/auth/viewer';
import { dbMessage, withUser } from '@/lib/db';
import { pushConfigured, sendTest } from '@/lib/push';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export type PushPrefs = { orders: boolean; messages: boolean; vets: boolean; payouts: boolean };

export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }, agent: string): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return { ok: false, error: 'invalid' };
  try {
    await withUser(
      viewer.id,
      (tx) => tx`select public.save_push_subscription(${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${agent.slice(0, 300)})`,
    );
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
}

export async function removePushSubscription(endpoint: string): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  await withUser(viewer.id, (tx) => tx`select public.remove_push_subscription(${endpoint})`);
  return { ok: true, data: undefined };
}

export async function savePushPrefs(prefs: PushPrefs): Promise<Result<PushPrefs>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const [row] = await withUser(viewer.id, (tx) => tx<{ p: PushPrefs }[]>`select public.set_push_prefs(${tx.json(prefs)}) as p`);
  return { ok: true, data: row.p };
}

export async function sendTestPush(): Promise<Result<{ sent: number }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  if (!pushConfigured) return { ok: false, error: 'notConfigured' };
  return { ok: true, data: { sent: await sendTest(viewer.id, viewer.preferredLanguage) } };
}

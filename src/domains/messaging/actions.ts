'use server';

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, withUser } from '@/lib/db';
import { allow } from '@/lib/rate-limit';
import { messagesAfter, type MessageRow } from './queries';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** "Message the farm" from a farm page. */
export async function openConversation(farmId: string, back: string): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  const id = await withUser(viewer.id, async (tx) => {
    const [row] = await tx<{ id: string }[]>`select public.open_conversation(${farmId}) as id`;
    await recordEvent(tx, { name: 'conversation.opened', userId: viewer.id, properties: { farm: farmId }, path: back });
    return row.id;
  });
  redirect(`/inbox/${id}`);
}

export async function sendMessage(conversationId: string, body: string, afterId: number): Promise<Result<MessageRow[]>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  if (!allow(`msg:${viewer.id}`, 20, 60_000)) return { ok: false, error: 'Too many messages. Wait a minute.' };
  const text = (body ?? '').trim().slice(0, 2000);
  if (!text) return { ok: false, error: 'empty' };
  try {
    const rows = await withUser(viewer.id, async (tx) => {
      await tx`insert into public.messages (conversation_id, body) values (${conversationId}, ${text})`;
      await recordEvent(tx, {
        name: 'message.sent',
        userId: viewer.id,
        properties: { conversation: conversationId, length: text.length },
        path: '/inbox',
      });
      return messagesAfter(tx, viewer.id, conversationId, afterId);
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
}

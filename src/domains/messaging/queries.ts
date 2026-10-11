import 'server-only';
import { withUser } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

export interface ConversationRow {
  id: string;
  farm_id: string;
  farm_name: string;
  farm_slug: string;
  i_am_buyer: boolean;
  other_name: string;
  last_message_at: string;
  last_body: string;
  last_kind: 'text' | 'order';
  unread: number;
}

export interface MessageRow {
  id: number;
  sender_id: string | null;
  kind: 'text' | 'order';
  body: string;
  order_number: string | null;
  created_at: string;
  mine: boolean;
}

export async function listConversations(viewer: Viewer): Promise<ConversationRow[]> {
  return withUser(
    viewer.id,
    (tx) => tx<ConversationRow[]>`
    select id, farm_id, farm_name, farm_slug, i_am_buyer, other_name, last_message_at::text as last_message_at,
           last_body, last_kind, unread
    from public.my_conversations()`,
  );
}

export async function unreadTotal(viewer: Viewer): Promise<number> {
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<{ n: number }[]>`select coalesce(sum(unread), 0)::int as n from public.my_conversations()`,
  );
  return row?.n ?? 0;
}

export async function getConversation(viewer: Viewer, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return withUser(viewer.id, async (tx) => {
    const [conv] = await tx<
      { id: string; farm_id: string; farm_name: string; farm_slug: string; i_am_buyer: boolean; other_name: string }[]
    >`
      select c.id, c.farm_id, f.name as farm_name, f.slug as farm_slug, c.buyer_id = ${viewer.id} as i_am_buyer,
             coalesce((select x.other_name from public.my_conversations() x where x.id = c.id),
                      case when c.buyer_id = ${viewer.id} then coalesce(f.farmer_name, f.name) else 'Buyer' end) as other_name
      from public.conversations c join public.farms f on f.id = c.farm_id
      where c.id = ${id}`;
    if (!conv) return null;
    const messages = await messagesAfter(tx, viewer.id, id, 0);
    return { ...conv, messages };
  });
}

type Tx = Parameters<Parameters<typeof withUser>[1]>[0];

export async function messagesAfter(tx: Tx, userId: string, conversationId: string, afterId: number): Promise<MessageRow[]> {
  const rows = await tx<MessageRow[]>`
    select * from (
      select m.id, m.sender_id, m.kind, m.body, o.number as order_number, m.created_at::text as created_at,
             m.sender_id = ${userId} as mine
      from public.messages m left join public.orders o on o.id = m.order_id
      where m.conversation_id = ${conversationId} and m.id > ${afterId}
      order by m.id desc limit 200
    ) x order by id`;
  const last = rows.at(-1);
  if (last) {
    await tx`
      insert into public.conversation_reads (conversation_id, user_id, last_read_message_id)
      values (${conversationId}, ${userId}, ${last.id})
      on conflict (conversation_id, user_id)
      do update set last_read_message_id = greatest(public.conversation_reads.last_read_message_id, excluded.last_read_message_id),
                    updated_at = now()`;
  }
  return rows;
}

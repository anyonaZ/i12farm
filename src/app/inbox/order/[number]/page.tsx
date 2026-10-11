import { notFound, redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';

// The conversation that belongs to an order (one thread per buyer and farm).
export default async function OrderConversation({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const viewer = await requireViewer(`/inbox/order/${number}`);
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<{ id: string }[]>`
    select c.id from public.orders o
    join public.conversations c on c.farm_id = o.farm_id and c.buyer_id = o.buyer_id
    where o.number = ${number.toUpperCase()}`,
  );
  if (!row) notFound();
  redirect(`/inbox/${row.id}`);
}

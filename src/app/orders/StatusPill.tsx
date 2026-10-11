import type { OrderStatus } from '@/domains/orders/types';

const TONE: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-amber/20 text-forest',
  paid: 'bg-lime/50 text-forest',
  accepted: 'bg-sprout/15 text-sprout-deep',
  ready: 'bg-sprout-deep text-white',
  completed: 'bg-mint text-soil',
  cancelled: 'bg-mint text-soil line-through',
  declined: 'bg-mint text-soil',
};

export function StatusPill({ status, label }: { status: OrderStatus; label: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[status]}`}>{label}</span>;
}

import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { listOrders } from '@/domains/orders/queries';
import type { OrderSummary } from '@/domains/orders/types';
import { requireViewer } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import { StatusPill } from './StatusPill';

export const metadata = { title: 'Orders', robots: { index: false } };

export default async function OrdersPage() {
  const viewer = await requireViewer('/orders');
  const t = await getTranslations('orders');
  const managesFarms = viewer.roles.includes('farmer') || viewer.roles.includes('agent') || viewer.roles.includes('admin');
  const [placed, incoming] = await Promise.all([
    listOrders(viewer, 'buyer'),
    managesFarms ? listOrders(viewer, 'farm') : Promise.resolve([]),
  ]);

  return (
    <main className="flex flex-col gap-5 px-4 pb-24 pt-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('title')}</h1>
        <LanguageSwitch />
      </header>

      {managesFarms ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-lg font-bold">{t('incoming')}</h2>
          {incoming.length ? <OrderList orders={incoming} side="farm" /> : <p className="card text-soil">{t('noneIncoming')}</p>}
        </section>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-lg font-bold">{t('placed')}</h2>
        {placed.length ? (
          <OrderList orders={placed} side="buyer" />
        ) : (
          <div className="card items-start gap-3">
            <p className="text-soil">{t('none')}</p>
            <Link href="/" className="btn-secondary w-auto">
              <Icon name="compass" size={18} />
              {(await getTranslations('cart'))('browse')}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

async function OrderList({ orders, side }: { orders: OrderSummary[]; side: 'buyer' | 'farm' }) {
  const t = await getTranslations('orders');
  const format = await getFormatter();
  return (
    <ul className="flex flex-col gap-2">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            href={`/orders/${o.number}`}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5"
          >
            <span className="min-w-0">
              <span className="block truncate font-bold">{side === 'buyer' ? o.farm_name : (o.buyer_name ?? t('buyer'))}</span>
              <span className="block truncate text-sm text-soil">
                #{o.number} · {format.relativeTime(new Date(o.created_at))}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <b className="tabular-nums">{kes(o.subtotal_kes)}</b>
              <StatusPill status={o.status} label={t(`status.${o.status}`)} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

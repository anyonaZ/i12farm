import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { getOrder } from '@/domains/orders/queries';
import { requireViewer } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import { pesiMode } from '@/lib/pesi';
import { displayPhone, toInternational } from '@/lib/phone';
import { StatusPill } from '../StatusPill';
import { BuyerActions, FarmActions, PaymentPanel, ReviewForm } from './OrderActions';

export const metadata = { title: 'Order', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const viewer = await requireViewer(`/orders/${number}`);
  const order = await getOrder(viewer, number.toUpperCase());
  if (!order) notFound();
  const t = await getTranslations('orders');
  const tu = await getTranslations('units');
  const format = await getFormatter();
  const lastPayment = order.payments[0] ?? null;
  const refundDue = order.paid_at && (order.status === 'cancelled' || order.status === 'declined');
  const farmPhone = toInternational(order.farm?.phone ?? null);
  const buyerPhone = toInternational(order.buyer_phone);

  return (
    <main className="mx-auto w-full flex flex-col gap-4 px-4 pb-28 pt-6 lg:max-w-3xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-start gap-3">
        <Link
          href="/orders"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface"
          aria-label={t('back')}
        >
          <Icon name="back" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <h1 className="text-xl font-extrabold">{t('order', { number: order.number })}</h1>
          <p className="max-w-full truncate text-sm text-soil">
            {order.i_am_buyer ? order.farm_name : (order.buyer_name ?? t('buyer'))} ·{' '}
            {t('placedOn', { when: format.relativeTime(new Date(order.created_at)) })}
          </p>
          <StatusPill status={order.status} label={t(`status.${order.status}`)} />
        </div>
      </header>

      {order.i_am_buyer && order.status === 'awaiting_payment' ? (
        <PaymentPanel
          orderId={order.id}
          number={order.number}
          total={order.subtotal_kes}
          phone={displayPhone(order.buyer_phone)}
          lastPayment={lastPayment}
          simulate={pesiMode === 'simulate'}
        />
      ) : null}

      {order.i_am_buyer && t.has(`buyerNext.${order.status}`) ? (
        <p className="card flex flex-row items-start gap-2.5 text-sm">
          <Icon name="clipboard" size={18} className="mt-0.5 shrink-0 text-sprout-deep" />
          {t(`buyerNext.${order.status}`)}
        </p>
      ) : null}
      {order.i_manage && !order.i_am_buyer && t.has(`farmNext.${order.status}`) ? (
        <p className="card flex flex-row items-start gap-2.5 border-sprout text-sm">
          <Icon name="clipboard" size={18} className="mt-0.5 shrink-0 text-sprout-deep" />
          {t(`farmNext.${order.status}`)}
        </p>
      ) : null}
      {refundDue ? <p className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">{t('refundDue')}</p> : null}

      {order.i_manage && !order.i_am_buyer ? <FarmActions orderId={order.id} status={order.status} /> : null}
      {order.i_am_buyer ? <BuyerActions orderId={order.id} status={order.status} /> : null}

      <section className="card gap-0 p-0">
        <h2 className="px-4 pb-1 pt-3.5 text-base font-bold">{t('items')}</h2>
        {order.items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm first:border-t-0">
            <span className="min-w-0">
              <b className="block truncate">{i.title}</b>
              <span className="tabular-nums text-soil">
                {i.quantity} × {kes(i.unit_price_kes)} / {tu.has(i.unit) ? tu(i.unit) : i.unit}
              </span>
            </span>
            <b className="tabular-nums">{kes(i.line_total_kes)}</b>
          </div>
        ))}
        <div className="flex justify-between border-t border-line px-4 py-3">
          <span className="font-bold">{t('total')}</span>
          <span className="text-lg font-extrabold tabular-nums">{kes(order.subtotal_kes)}</span>
        </div>
        {order.i_manage && !order.i_am_buyer ? (
          <div className="flex flex-col gap-1 border-t border-line bg-mint px-4 py-3 text-sm">
            <span className="flex justify-between text-soil">
              <span>{t('commission', { pct: order.commission_bps / 100 })}</span>
              <span className="tabular-nums">− {kes(order.commission_kes)}</span>
            </span>
            <span className="flex justify-between font-bold">
              <span>{t('payout')}</span>
              <span className="tabular-nums">{kes(order.farmer_payout_kes)}</span>
            </span>
            <span className="text-xs text-soil">{t('heldNote')}</span>
          </div>
        ) : null}
      </section>

      <section className="card gap-2 text-sm">
        <Row
          label={order.fulfilment === 'pickup' ? t('pickup') : t('delivery')}
          value={order.fulfilment === 'pickup' ? (order.farm?.place ?? '') : ''}
        />
        {order.visit_date ? (
          <Row
            label={t('visit')}
            value={`${format.dateTime(new Date(`${order.visit_date}T12:00:00+03:00`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}, ${t(`slot.${order.visit_slot ?? 'morning'}`)}`}
          />
        ) : null}
        {order.delivery_note ? <Row label={t('note')} value={order.delivery_note} /> : null}
        {order.i_manage && !order.i_am_buyer ? <Row label={t('phone')} value={displayPhone(order.buyer_phone)} /> : null}
        {order.payments
          .filter((p) => p.receipt)
          .map((p) => (
            <Row key={p.id} label={t('receipt', { code: '' }).trim()} value={p.receipt ?? ''} />
          ))}
        <div className="mt-1 grid grid-cols-2 gap-2">
          {order.i_am_buyer && farmPhone ? (
            <a href={`tel:+${farmPhone}`} className="btn-secondary min-h-11 text-sm">
              <Icon name="phone" size={16} />
              {t('callFarm')}
            </a>
          ) : null}
          {!order.i_am_buyer && buyerPhone ? (
            <a href={`tel:+${buyerPhone}`} className="btn-secondary min-h-11 text-sm">
              <Icon name="phone" size={16} />
              {t('callBuyer')}
            </a>
          ) : null}
          <Link href={`/inbox/order/${order.number}`} className="btn-secondary min-h-11 text-sm">
            <Icon name="chat" size={16} />
            {order.i_am_buyer ? t('message') : t('messageBuyer')}
          </Link>
        </div>
      </section>

      <section className="card gap-3">
        <h2 className="text-base font-bold">{t('timeline')}</h2>
        <ol className="flex flex-col gap-3 border-l-2 border-line pl-4">
          {order.history.map((h, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[1.4rem] top-1 size-3 rounded-full border-2 border-surface bg-sprout" aria-hidden="true" />
              <b className="block">{t(`event.${h.to}`)}</b>
              <span className="text-soil">
                {format.dateTime(new Date(h.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
                {h.note ? ` · ${h.note}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {order.i_am_buyer && order.status === 'completed' ? <ReviewForm orderId={order.id} existing={order.review} /> : null}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-soil">{label}</span>
      <span className="min-w-0 text-right font-semibold">{value}</span>
    </div>
  );
}

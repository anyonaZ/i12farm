'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { changeOrderStatus, checkPayment, leaveReview, payOrder, simulate } from '@/domains/orders/actions';
import type { OrderStatus, PaymentStatus } from '@/domains/orders/types';
import { kes } from '@/lib/format';

function useOrderError() {
  const t = useTranslations('orders');
  const [error, setError] = useState('');
  return {
    error,
    clear: () => setError(''),
    fail: (r: { error: string; detail?: string }) => setError(t('error', { reason: r.detail ?? r.error })),
    node: error ? (
      <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
        {error}
      </p>
    ) : null,
  };
}

// Waiting for M-Pesa: polls the order every 4 s for up to two minutes, then
// asks Daraja directly once ("I've paid, check now" does the same on demand).
export function PaymentPanel({
  orderId,
  number,
  total,
  phone,
  lastPayment,
  simulate: simulateMode,
}: {
  orderId: string;
  number: string;
  total: number;
  phone: string;
  lastPayment: { status: PaymentStatus; result_desc: string | null } | null;
  simulate: boolean;
}) {
  const t = useTranslations('orders');
  const tc = useTranslations('checkout');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [payPhone, setPayPhone] = useState(phone);
  const err = useOrderError();
  const waiting = lastPayment?.status === 'requested';
  const polls = useRef(0);

  useEffect(() => {
    if (!waiting) return;
    polls.current = 0;
    const timer = setInterval(async () => {
      polls.current += 1;
      const response = await fetch(`/api/orders/${number}`, { cache: 'no-store' }).catch(() => null);
      const row = response?.ok ? ((await response.json()) as { status: OrderStatus; payment: PaymentStatus | null }) : null;
      if (row && (row.status !== 'awaiting_payment' || row.payment !== 'requested')) {
        clearInterval(timer);
        router.refresh();
      } else if (polls.current === 15) {
        await checkPayment(orderId);
        router.refresh();
      } else if (polls.current > 30) {
        clearInterval(timer);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [waiting, number, orderId, router]);

  const failed = lastPayment && lastPayment.status !== 'requested' && lastPayment.status !== 'succeeded';

  return (
    <section className="card gap-3 border-forest">
      {waiting ? (
        <div className="flex items-start gap-3" role="status">
          <span className="relative mt-1 flex size-3 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-sprout opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-sprout-deep" />
          </span>
          <div>
            <p className="font-bold">{t('waiting')}</p>
            <p className="text-sm text-soil">{kes(total)}</p>
            {simulateMode ? <p className="mt-1 text-sm text-soil">{t('waitingSim')}</p> : null}
          </div>
        </div>
      ) : null}

      {failed ? (
        <p className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
          {t('paymentFailed', { reason: lastPayment?.result_desc ?? lastPayment?.status ?? '' })}
        </p>
      ) : null}
      {err.node}

      {waiting && simulateMode ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending}
            className="btn-primary min-h-11 text-sm"
            onClick={() =>
              start(async () => {
                await simulate(orderId, 'success');
                router.refresh();
              })
            }
          >
            {t('simulatePay')}
          </button>
          <button
            type="button"
            disabled={pending}
            className="btn-secondary min-h-11 text-sm"
            onClick={() =>
              start(async () => {
                await simulate(orderId, 'cancel');
                router.refresh();
              })
            }
          >
            {t('simulateCancel')}
          </button>
        </div>
      ) : null}

      {!waiting ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-phone" className="text-sm font-bold">
              {tc('mpesaPhone')}
            </label>
            <input
              id="pay-phone"
              type="tel"
              inputMode="tel"
              value={payPhone}
              onChange={(e) => setPayPhone(e.target.value)}
              className="input tabular-nums"
            />
          </div>
          <button
            type="button"
            disabled={pending}
            className="btn-primary min-h-13"
            onClick={() =>
              start(async () => {
                err.clear();
                const r = await payOrder(orderId, payPhone);
                if (!r.ok) err.fail(r);
                router.refresh();
              })
            }
          >
            <Icon name="wallet" size={18} />
            {failed ? t('payAgain') : t('payNow')} · {kes(total)}
          </button>
        </>
      ) : (
        !simulateMode && (
          <button
            type="button"
            disabled={pending}
            className="btn-secondary min-h-11 text-sm"
            onClick={() =>
              start(async () => {
                await checkPayment(orderId);
                router.refresh();
              })
            }
          >
            {t('checkPayment')}
          </button>
        )
      )}
    </section>
  );
}

export function FarmActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const t = useTranslations('orders');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const err = useOrderError();

  function move(to: OrderStatus, note?: string) {
    start(async () => {
      err.clear();
      const r = await changeOrderStatus(orderId, to, note);
      if (!r.ok) err.fail(r);
      setDeclining(false);
      router.refresh();
    });
  }

  if (status !== 'paid' && status !== 'accepted') return err.node;

  return (
    <section className="flex flex-col gap-2.5">
      {err.node}
      {declining ? (
        <div className="card gap-2.5">
          <label htmlFor="decline-reason" className="text-sm font-bold">
            {t('declineReason')}
          </label>
          <textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            className="input min-h-20 py-3"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending}
              className="btn-primary min-h-11 bg-ink text-sm"
              onClick={() => move('declined', reason)}
            >
              {status === 'accepted' ? t('confirmCancelAccepted') : t('confirmDecline')}
            </button>
            <button type="button" className="btn-secondary min-h-11 text-sm" onClick={() => setDeclining(false)}>
              {t('back')}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          {status === 'paid' ? (
            <button type="button" disabled={pending} className="btn-primary min-h-13" onClick={() => move('accepted')}>
              <Icon name="check" size={18} />
              {t('accept')}
            </button>
          ) : (
            <button type="button" disabled={pending} className="btn-primary min-h-13" onClick={() => move('ready')}>
              <Icon name="bag" size={18} />
              {t('markReady')}
            </button>
          )}
          <button type="button" disabled={pending} className="btn-secondary min-h-13" onClick={() => setDeclining(true)}>
            {status === 'accepted' ? t('cancelAccepted') : t('decline')}
          </button>
        </div>
      )}
    </section>
  );
}

export function BuyerActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const t = useTranslations('orders');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const err = useOrderError();

  function move(to: OrderStatus) {
    start(async () => {
      err.clear();
      const r = await changeOrderStatus(orderId, to);
      if (!r.ok) err.fail(r);
      router.refresh();
    });
  }

  if (status === 'ready') {
    // Receiving closes the order for good, so it takes a second, deliberate tap.
    return (
      <section className="flex flex-col gap-2">
        {err.node}
        {confirming ? (
          <div className="card gap-3 border-sprout-deep" role="alertdialog" aria-labelledby="recv-q" aria-describedby="recv-w">
            <p id="recv-q" className="text-lg font-bold">
              {t('receivedQuestion')}
            </p>
            <p id="recv-w" className="text-sm text-soil">
              {t('receivedWarn')}
            </p>
            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <button type="button" disabled={pending} autoFocus className="btn-primary min-h-13" onClick={() => move('completed')}>
                <Icon name="check" size={18} />
                {t('receivedYes')}
              </button>
              <button type="button" className="btn-secondary min-h-13" onClick={() => setConfirming(false)}>
                {t('notYet')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-primary min-h-14 text-lg" onClick={() => setConfirming(true)}>
            <Icon name="check" size={20} />
            {t('confirmReceived')}
          </button>
        )}
      </section>
    );
  }
  if (status === 'awaiting_payment') {
    return (
      <section className="flex flex-col gap-2">
        {err.node}
        <button type="button" disabled={pending} className="inline-flex min-h-11 items-center self-start text-sm font-bold text-soil underline" onClick={() => move('cancelled')}>
          {t('cancel')}
        </button>
      </section>
    );
  }
  return err.node;
}

export function ReviewForm({ orderId, existing }: { orderId: string; existing: { rating: number; body: string | null } | null }) {
  const t = useTranslations('orders');
  const router = useRouter();
  const [stars, setStars] = useState(0);
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const err = useOrderError();

  if (existing) {
    return (
      <section className="card gap-2">
        <h2 className="text-base font-bold">{t('yourReview')}</h2>
        <StarRow value={existing.rating} />
        {existing.body ? <p className="text-sm">{existing.body}</p> : null}
      </section>
    );
  }

  return (
    <section className="card gap-3 border-sprout">
      <div>
        <h2 className="text-lg font-bold">{t('reviewTitle')}</h2>
        <p className="text-sm text-soil">{t('reviewHint')}</p>
      </div>
      <StarRow value={stars} onChange={setStars} />
      <label htmlFor="review-body" className="text-sm font-bold">
        {t('reviewBody')}
      </label>
      <textarea id="review-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} className="input min-h-24 py-3" />
      {err.node}
      <button
        type="button"
        disabled={pending || stars === 0}
        className="btn-primary"
        onClick={() =>
          start(async () => {
            const r = await leaveReview(orderId, stars, body);
            if (!r.ok) err.fail(r);
            router.refresh();
          })
        }
      >
        {t('reviewSubmit')}
      </button>
    </section>
  );
}

function StarRow({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  const t = useTranslations('orders');
  return (
    <div className="flex gap-1" role={onChange ? 'radiogroup' : 'img'} aria-label={t('stars', { n: value })}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t('stars', { n })}
            onClick={() => onChange(n)}
            className="grid size-11 place-items-center rounded-full"
          >
            <Icon name="star" size={28} className={n <= value ? 'fill-amber text-amber' : 'text-line'} />
          </button>
        ) : (
          <Icon key={n} name="star" size={20} className={n <= value ? 'fill-amber text-amber' : 'text-line'} />
        ),
      )}
    </div>
  );
}

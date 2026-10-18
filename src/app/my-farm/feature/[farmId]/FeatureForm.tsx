'use client';

import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { buyFeatured, retryFeaturedPayment, simulateFeatured } from '@/domains/promotions/actions';
import type { PromotionState } from '@/domains/promotions/queries';
import { kes } from '@/lib/format';
import { isKenyanMobile } from '@/lib/phone';

export function FeatureForm({
  farm,
  plans,
  defaultPhone,
  simulate,
}: {
  farm: { id: string; name: string };
  plans: { days: number; price: number }[];
  defaultPhone: string;
  simulate: boolean;
}) {
  const t = useTranslations('featured');
  const format = useFormatter();
  const router = useRouter();
  const [days, setDays] = useState(plans[0]?.days ?? 7);
  const [phone, setPhone] = useState(defaultPhone);
  const [promotionId, setPromotionId] = useState<string | null>(null);
  const [state, setState] = useState<PromotionState | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const plan = plans.find((p) => p.days === days);

  // While a prompt is out, poll every 3 s (up to 3 minutes).
  useEffect(() => {
    if (!promotionId) return;
    let n = 0;
    const timer = setInterval(async () => {
      n += 1;
      const response = await fetch(`/api/promotions/${promotionId}`, { cache: 'no-store' }).catch(() => null);
      if (response?.ok) {
        const next = (await response.json()) as PromotionState;
        setState(next);
        if (next.status === 'active' || (next.payment && next.payment !== 'requested')) {
          clearInterval(timer);
          if (next.status === 'active') router.refresh();
        }
      }
      if (n > 60) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [promotionId, router]);

  const fail = (r: { error: string; detail?: string }) =>
    setError(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`, { detail: r.detail ?? '' }) : (r.detail ?? r.error));

  function pay() {
    setError('');
    if (!isKenyanMobile(phone)) {
      setError(t('errors.phone'));
      return;
    }
    start(async () => {
      const r =
        promotionId && state?.status === 'awaiting_payment'
          ? await retryFeaturedPayment(promotionId, phone)
          : await buyFeatured(farm.id, days, phone);
      if (!r.ok) return fail(r);
      if ('data' in r && r.data && 'promotionId' in r.data) setPromotionId(r.data.promotionId);
      setState((s) => (s ? { ...s, payment: 'requested' } : s));
    });
  }

  if (state?.status === 'active') {
    return (
      <section className="card items-center gap-3 text-center" role="status">
        <span className="grid size-14 place-items-center rounded-full bg-lime">
          <Icon name="star" size={28} className="fill-forest text-forest" />
        </span>
        <p className="text-lg font-bold">
          {t('active', {
            farm: farm.name,
            date: format.dateTime(new Date(state.ends_at ?? Date.now()), { day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' }),
          })}
        </p>
      </section>
    );
  }

  const waiting = Boolean(promotionId) && (!state || state.payment === 'requested');
  const failed = state && state.payment && state.payment !== 'requested' && state.payment !== 'succeeded';

  return (
    <section className="flex flex-col gap-3">
      <fieldset className="grid grid-cols-2 gap-2.5" disabled={waiting}>
        <legend className="mb-2 text-sm font-bold">{t('choose')}</legend>
        {plans.map((p) => (
          <label
            key={p.days}
            className={`flex cursor-pointer flex-col gap-1 rounded-2xl border bg-surface p-4 ${days === p.days ? 'border-sprout-deep shadow-[inset_0_0_0_1px_var(--color-sprout-deep)]' : 'border-line'}`}
          >
            <input type="radio" name="plan" className="sr-only" checked={days === p.days} onChange={() => setDays(p.days)} />
            <span className="text-sm text-soil">{t('plan', { days: p.days })}</span>
            <span className="text-xl font-extrabold tabular-nums">{kes(p.price)}</span>
          </label>
        ))}
      </fieldset>

      <div className="card gap-3">
        <label htmlFor="feat-phone" className="text-sm font-bold">
          {t('phone')}
        </label>
        <input
          id="feat-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input tabular-nums"
          disabled={waiting}
        />

        {waiting ? (
          <div className="flex items-start gap-3" role="status">
            <span className="relative mt-1 flex size-3 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sprout opacity-60" />
              <span className="relative inline-flex size-3 rounded-full bg-sprout-deep" />
            </span>
            <p className="font-semibold">{t('waiting')}</p>
          </div>
        ) : null}
        {failed ? (
          <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
            {t('failed', { reason: state?.payment_desc ?? state?.payment ?? '' })}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
            {error}
          </p>
        ) : null}

        {waiting && simulate && promotionId ? (
          <div className="grid grid-cols-2 gap-2">
            {(['success', 'cancel'] as const).map((outcome) => (
              <button
                key={outcome}
                type="button"
                disabled={pending}
                className={`${outcome === 'success' ? 'btn-primary' : 'btn-secondary'} min-h-11 text-sm`}
                onClick={() =>
                  start(async () => {
                    await simulateFeatured(promotionId, outcome);
                    const response = await fetch(`/api/promotions/${promotionId}`, { cache: 'no-store' });
                    if (response.ok) setState((await response.json()) as PromotionState);
                  })
                }
              >
                {outcome === 'success' ? t('simulatePay') : t('simulateCancel')}
              </button>
            ))}
          </div>
        ) : null}

        {!waiting ? (
          <button type="button" disabled={pending || !plan} onClick={pay} className="btn-primary min-h-13">
            <Icon name="wallet" size={18} />
            {failed ? t('tryAgain') : t('pay', { price: kes(plan?.price ?? 0) })}
          </button>
        ) : null}
      </div>
    </section>
  );
}

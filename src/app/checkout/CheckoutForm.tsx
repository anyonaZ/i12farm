'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { CartStepper } from '@/components/cart/CartStepper';
import { Icon } from '@/components/Icon';
import { placeOrder } from '@/domains/orders/actions';
import { track } from '@/lib/analytics/track';
import { clearCart, replaceLines, useCart, type CartLine } from '@/lib/cart';
import { kes } from '@/lib/format';
import { isKenyanMobile } from '@/lib/phone';

interface Listing {
  id: string;
  title: string;
  unit: string;
  price_kes: number;
  quantity: number | null;
  type: string;
}

/** yyyy-mm-dd, `days` from today in Nairobi time. */
function nairobiDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(d);
}

export function CheckoutForm({
  farm,
  listings,
  signedIn,
  signInHref,
  defaults,
}: {
  farm: { id: string; slug: string; name: string };
  listings: Listing[];
  signedIn: boolean;
  signInHref: string;
  defaults: { name: string; phone: string };
}) {
  const t = useTranslations('checkout');
  const tc = useTranslations('cart');
  const tu = useTranslations('units');
  const router = useRouter();
  const cart = useCart();
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [note, setNote] = useState('');
  const [name, setName] = useState(defaults.name);
  const [phone, setPhone] = useState(defaults.phone);
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState(false);
  const [visitDate, setVisitDate] = useState('');
  const [visitSlot, setVisitSlot] = useState<'morning' | 'afternoon'>('morning');
  const [pending, start] = useTransition();

  // Re-price the cart from the live listings; drop anything no longer on sale.
  useEffect(() => {
    if (!cart || cart.farmId !== farm.id) return;
    const next: Record<string, CartLine> = {};
    let changed = false;
    for (const [id, line] of Object.entries(cart.lines)) {
      const live = listings.find((l) => l.id === id);
      if (!live || (live.quantity !== null && live.quantity <= 0)) {
        changed = true;
        continue;
      }
      const qty = live.quantity === null ? line.qty : Math.min(line.qty, live.quantity);
      if (qty !== line.qty || live.price_kes !== line.price || live.quantity !== line.max) changed = true;
      next[id] = { ...line, qty, price: live.price_kes, max: live.quantity };
    }
    if (changed) {
      if (Object.keys(next).length < Object.keys(cart.lines).length) setRemoved(true);
      replaceLines(next);
    }
  }, [cart, farm.id, listings]);

  useEffect(() => {
    track('checkout.started', { farm: farm.id });
  }, [farm.id]);

  const lines = useMemo(
    () =>
      cart && cart.farmId === farm.id
        ? Object.entries(cart.lines)
            .map(([id, line]) => ({ id, line, live: listings.find((l) => l.id === id) }))
            .filter((x) => x.live)
        : [],
    [cart, farm.id, listings],
  );
  const total = lines.reduce((sum, x) => sum + x.line.qty * (x.live?.price_kes ?? 0), 0);
  const hasBooking = lines.some((x) => x.live?.type === 'experience');
  const onlyBookings = lines.length > 0 && lines.every((x) => x.live?.type === 'experience');

  if (lines.length === 0) {
    return (
      <div className="card items-center gap-3 text-center">
        <Icon name="bag" size={32} className="text-sprout-deep" />
        <p className="text-soil">{tc('empty')}</p>
        <Link href={`/f/${farm.slug}`} className="btn-secondary">
          {farm.name}
        </Link>
      </div>
    );
  }

  function submit() {
    setError('');
    if (!isKenyanMobile(phone)) {
      setError(t('errors.phone'));
      return;
    }
    if (hasBooking && (!visitDate || visitDate < nairobiDate(1))) {
      setError(t('errors.visit'));
      return;
    }
    start(async () => {
      const result = await placeOrder({
        farmId: farm.id,
        items: lines.map((x) => ({ listingId: x.id, quantity: x.line.qty })),
        fulfilment,
        deliveryNote: note,
        buyerName: name,
        buyerPhone: phone,
        visitDate: hasBooking ? visitDate : null,
        visitSlot: hasBooking ? visitSlot : null,
      });
      if (!result.ok) {
        setError(
          t.has(`errors.${result.error}`) ? t(`errors.${result.error}`, { detail: result.detail ?? '' }) : (result.detail ?? result.error),
        );
        return;
      }
      clearCart();
      router.push(`/orders/${result.data.number}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {removed ? <p className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">{t('removed')}</p> : null}

      <section className="card gap-0 p-0">
        {lines.map(({ id, line, live }) => (
          <div key={id} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 first:border-t-0">
            <div className="min-w-0">
              <h2 className="truncate font-bold">{line.title}</h2>
              <p className="text-sm tabular-nums text-soil">
                {kes(live!.price_kes)} / {tu.has(live!.unit) ? tu(live!.unit) : line.unit}
                {live!.quantity !== null ? ` · ${tc('left', { n: live!.quantity })}` : ''}
              </p>
            </div>
            <CartStepper
              farm={farm}
              listing={{
                id,
                title: line.title,
                unit: line.unit,
                price: live!.price_kes,
                max: live!.quantity,
                booking: live!.type === 'experience',
              }}
            />
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-line px-4 py-3.5">
          <span className="font-bold">{t('total')}</span>
          <span className="text-xl font-extrabold tabular-nums">{kes(total)}</span>
        </div>
      </section>

      {hasBooking ? (
        <fieldset className="card gap-2.5">
          <legend className="sr-only">{t('visitTitle')}</legend>
          <h2 className="text-base font-bold" aria-hidden="true">
            {t('visitTitle')}
          </h2>
          <label htmlFor="co-visit" className="text-sm font-bold">
            {t('visitDate')}
          </label>
          <input
            id="co-visit"
            type="date"
            min={nairobiDate(1)}
            max={nairobiDate(120)}
            value={visitDate}
            onChange={(e) => {
              setVisitDate(e.target.value);
              track('booking.date_chosen', { farm: farm.id });
            }}
            className="input"
          />
          <div className="grid grid-cols-2 gap-2">
            {(['morning', 'afternoon'] as const).map((slot) => (
              <label
                key={slot}
                className={`flex items-center gap-2 rounded-2xl border p-3 text-sm font-semibold ${visitSlot === slot ? 'border-sprout-deep' : 'border-line'}`}
              >
                <input
                  type="radio"
                  name="visit-slot"
                  checked={visitSlot === slot}
                  onChange={() => setVisitSlot(slot)}
                  className="size-5 accent-sprout-deep"
                />
                {t(slot)}
              </label>
            ))}
          </div>
          <p className="text-xs text-soil">{t('visitHint')}</p>
        </fieldset>
      ) : null}

      <fieldset className="card gap-2.5">
        <legend className="sr-only">{t('fulfilment')}</legend>
        {!onlyBookings ? (
          <h2 className="text-base font-bold" aria-hidden="true">
            {t('fulfilment')}
          </h2>
        ) : null}
        {(onlyBookings ? [] : (['pickup', 'delivery'] as const)).map((f) => (
          <label
            key={f}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-sm font-semibold ${fulfilment === f ? 'border-sprout-deep' : 'border-line'}`}
          >
            <input
              type="radio"
              name="fulfilment"
              value={f}
              checked={fulfilment === f}
              onChange={() => setFulfilment(f)}
              className="size-5 accent-sprout-deep"
            />
            {t(f)}
          </label>
        ))}
        <label htmlFor="co-note" className="mt-1 text-sm font-bold">
          {t('note')}
        </label>
        <textarea
          id="co-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder={t('noteHint')}
          className="input min-h-20 py-3"
        />
      </fieldset>

      {signedIn ? (
        <section className="card gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="co-name" className="text-sm font-bold">
              {t('name')}
            </label>
            <input
              id="co-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoComplete="name"
              className="input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="co-phone" className="text-sm font-bold">
              {t('mpesaPhone')}
            </label>
            <input
              id="co-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
              autoComplete="tel"
              className="input tabular-nums"
            />
            <span className="text-xs text-soil">{t('mpesaHint')}</span>
          </div>
          <p className="flex gap-2 rounded-xl bg-mint p-3 text-sm">
            <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-sprout-deep" />
            {t('held')}
          </p>
          {error ? (
            <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={submit} disabled={pending} className="btn-primary min-h-14 text-lg">
            {pending ? t('placing') : t('pay', { total: kes(total) })}
          </button>
        </section>
      ) : (
        <section className="card gap-3">
          <p className="text-soil">{t('signInHint')}</p>
          <Link href={signInHref} className="btn-primary">
            {t('signIn')}
          </Link>
        </section>
      )}
    </div>
  );
}

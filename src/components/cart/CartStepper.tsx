'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { setLine, track, useCartLine } from './cart-hooks';

interface Props {
  farm: { id: string; slug: string; name: string };
  listing: { id: string; title: string; unit: string; price: number; max: number | null };
}

// "Add" button that becomes − n + once the item is in the cart.
export function CartStepper({ farm, listing }: Props) {
  const t = useTranslations('cart');
  const { line, otherFarm } = useCartLine(farm.id, listing.id);
  const [confirming, setConfirming] = useState(false);
  const qty = line?.qty ?? 0;
  const atMax = listing.max !== null && qty >= listing.max;

  function change(next: number) {
    setLine(
      farm,
      listing.id,
      next > 0 ? { qty: next, price: listing.price, title: listing.title, unit: listing.unit, max: listing.max } : null,
    );
    track(next > qty ? 'cart.item_added' : 'cart.item_removed', { farm: farm.id, listing: listing.id, qty: next });
  }

  if (confirming && otherFarm) {
    return (
      <div className="col-span-2 flex flex-col gap-2 rounded-xl bg-amber/15 p-3 text-sm" role="alertdialog">
        <p className="font-semibold">{t('otherFarm', { farm: otherFarm })}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary min-h-10 text-sm"
            onClick={() => {
              setConfirming(false);
              setLine(farm, listing.id, { qty: 1, price: listing.price, title: listing.title, unit: listing.unit, max: listing.max });
              track('cart.item_added', { farm: farm.id, listing: listing.id, qty: 1, replaced: true });
            }}
          >
            {t('replace')}
          </button>
          <button type="button" className="btn-secondary min-h-10 text-sm" onClick={() => setConfirming(false)}>
            {t('keep')}
          </button>
        </div>
      </div>
    );
  }

  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={() => (otherFarm ? setConfirming(true) : change(1))}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-sprout-deep px-4 text-sm font-bold text-white"
      >
        <Icon name="plus" size={16} />
        {t('add')}
      </button>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-sprout-deep bg-surface p-0.5"
      role="group"
      aria-label={listing.title}
    >
      <button
        type="button"
        onClick={() => change(qty - 1)}
        className="grid size-9 place-items-center rounded-full text-sprout-deep"
        aria-label={t('decrease')}
      >
        <Icon name="minus" size={16} />
      </button>
      <output className="min-w-6 text-center font-bold tabular-nums" aria-live="polite">
        {qty}
      </output>
      <button
        type="button"
        disabled={atMax}
        onClick={() => change(qty + 1)}
        className="grid size-9 place-items-center rounded-full text-sprout-deep disabled:opacity-40"
        aria-label={t('increase')}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

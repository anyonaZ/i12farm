'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { updateListingPrice } from '@/domains/farms/actions';
import { kes } from '@/lib/format';

export function PriceEditor({
  listingId,
  name,
  unitLabel,
  price,
  history,
}: {
  listingId: string;
  name: string;
  unitLabel: string;
  price: number | null;
  history: number[];
}) {
  const t = useTranslations('myFarm');
  const [value, setValue] = useState(price === null ? '' : String(Math.round(price)));
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pending, start] = useTransition();
  const changed = Number(value) > 0 && Number(value) !== Math.round(price ?? -1);

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2 border-t border-line py-2.5 first:border-t-0"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateListingPrice(listingId, Number(value));
          setStatus(r.ok ? 'saved' : 'error');
        });
      }}
    >
      <div className="min-w-0">
        <h3 className="truncate text-sm font-bold">{name}</h3>
        <span className="text-xs text-soil">{unitLabel}</span>
      </div>
      <label htmlFor={`price-${listingId}`} className="sr-only">
        {name}
      </label>
      <input
        id={`price-${listingId}`}
        className="input min-h-10 tabular-nums"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          setValue(e.target.value.replace(/[^\d]/g, ''));
          setStatus('idle');
        }}
      />
      <button type="submit" disabled={!changed || pending} className="btn-secondary min-h-10 w-auto px-3.5 text-sm">
        {t('savePrice')}
      </button>
      {history.length > 1 || status !== 'idle' ? (
        <p className="col-span-3 text-xs tabular-nums text-soil" role={status === 'idle' ? undefined : 'status'}>
          {status === 'saved' ? t('priceSaved') : status === 'error' ? t('priceError') : history.map((h) => kes(h)).join(' → ')}
        </p>
      ) : null}
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { addListing, setFarmPublished, setListingStatus } from '@/domains/farms/actions';

/** Pause / resume / remove one product. Remove asks once more before it goes. */
export function ListingControls({ listingId, status, label }: { listingId: string; status: string; label: string }) {
  const t = useTranslations('farmEdit');
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const act = (to: 'active' | 'paused' | 'archived') =>
    start(async () => {
      await setListingStatus(listingId, to);
      setConfirm(false);
      router.refresh();
    });
  const paused = status === 'paused';
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 text-sm">
      {paused ? <span className="rounded-full bg-amber/20 px-2.5 py-1 text-xs font-bold">{t('pausedPill')}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => act(paused ? 'active' : 'paused')}
        className="inline-flex min-h-11 items-center rounded-full border border-line px-3.5 font-semibold"
        aria-label={`${paused ? t('resume') : t('pause')}: ${label}`}
      >
        {paused ? t('resume') : t('pause')}
      </button>
      {confirm ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => act('archived')}
          className="inline-flex min-h-11 items-center rounded-full bg-red-700 px-3.5 font-semibold text-white"
        >
          {t('removeConfirm')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-soil underline"
          aria-label={`${t('remove')}: ${label}`}
        >
          {t('remove')}
        </button>
      )}
    </div>
  );
}

/** Add a product to a published farm. Products are limited to the farm's types. */
export function AddProduct({ farmId, products }: { farmId: string; products: { slug: string; name: string; unit: string }[] }) {
  const t = useTranslations('farmEdit');
  const tu = useTranslations('units');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState(products[0]?.slug ?? '');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const unit = products.find((p) => p.slug === product)?.unit;
  if (!products.length) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary">
        <Icon name="plus" size={18} />
        {t('addProduct')}
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2.5 rounded-2xl border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        start(async () => {
          const r = await addListing(farmId, { productSlug: product, title, price, quantity: qty });
          if (r.ok) {
            setOpen(false);
            setTitle('');
            setPrice('');
            setQty('');
            router.refresh();
          } else setError(r.error === 'price' ? t('errPrice') : (r.detail ?? r.error));
        });
      }}
    >
      <h4 className="font-bold">{t('addProduct')}</h4>
      <label htmlFor={`ap-p-${farmId}`} className="text-sm font-bold">
        {t('product')}
      </label>
      <select id={`ap-p-${farmId}`} value={product} onChange={(e) => setProduct(e.target.value)} className="input">
        {products.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
      <label htmlFor={`ap-t-${farmId}`} className="text-sm font-bold">
        {t('productTitle')}
      </label>
      <input
        id={`ap-t-${farmId}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        placeholder={t('productTitleHint')}
        className="input"
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`ap-pr-${farmId}`} className="text-sm font-bold">
            {t('price', { unit: unit ? tu(unit as never) : '' })}
          </label>
          <input
            id={`ap-pr-${farmId}`}
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
            className="input tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`ap-q-${farmId}`} className="text-sm font-bold">
            {t('quantity')}
          </label>
          <input
            id={`ap-q-${farmId}`}
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
            className="input tabular-nums"
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-soil">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {t('addButton')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary w-auto px-5">
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

/** Hide the whole farm from Explore and search for a while (or show it again). */
export function PauseFarm({ farmId, published }: { farmId: string; published: boolean }) {
  const t = useTranslations('farmEdit');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setFarmPublished(farmId, !published);
          router.refresh();
        })
      }
      className="btn-secondary"
    >
      {published ? t('pauseFarm') : t('publishFarm')}
    </button>
  );
}

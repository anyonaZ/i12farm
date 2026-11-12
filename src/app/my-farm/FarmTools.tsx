'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { issueClaimCode, updateListingQuantity } from '@/domains/farms/actions';
import { track } from '@/lib/analytics/track';
import { compressImage } from '@/lib/images';
import { publicMediaUrl } from '@/lib/media-url';

/** Agent view: issue the one-time code a farmer uses to take over the farm. */
export function ClaimCode({ farmId }: { farmId: string }) {
  const t = useTranslations('myFarmPlus');
  const [code, setCode] = useState<{ code: string; expires: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-mint p-3">
      <span className="text-sm font-bold">{t('claim')}</span>
      {code ? (
        <>
          <output className="text-center font-mono text-3xl font-extrabold tracking-[0.25em] tabular-nums">
            {code.code.slice(0, 4)} {code.code.slice(4)}
          </output>
          <span className="text-xs text-soil">
            {t('codeValid', { date: new Date(code.expires).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) })}
          </span>
        </>
      ) : (
        <span className="text-xs text-soil">{t('claimHint')}</span>
      )}
      {error ? <span className="text-xs font-semibold text-forest">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        className="btn-secondary min-h-11 text-sm"
        onClick={() =>
          start(async () => {
            const r = await issueClaimCode(farmId);
            if (r.ok) setCode(r.data);
            else setError(r.error);
          })
        }
      >
        <Icon name="lock" size={16} />
        {t('getCode')}
      </button>
    </div>
  );
}

/** Photos on My Farm: add (shrunk on the phone first) and remove. */
export function PhotoManager({ farmId, photos }: { farmId: string; photos: { id: string; storage_path: string }[] }) {
  const t = useTranslations('myFarmPlus');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    for (const file of Array.from(files).slice(0, 8 - photos.length)) {
      try {
        const img = await compressImage(file);
        const form = new FormData();
        form.set('file', img.blob, img.blob.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
        form.set('width', String(img.width));
        form.set('height', String(img.height));
        const response = await fetch(`/api/farms/${farmId}/photos`, { method: 'POST', body: form });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setError(t('photoError', { reason: body.error ?? String(response.status) }));
        } else {
          track('farm.photo_added', { farm: farmId, bytes: img.blob.size });
        }
      } catch {
        setError(t('photoError', { reason: 'unreadable image' }));
      }
    }
    setBusy(false);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/farms/${farmId}/photos/${id}`, { method: 'DELETE' }).catch(() => undefined);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-bold">{t('photos')}</h4>
      <div className="grid grid-cols-4 gap-2">
        {photos.map((p) => (
          <figure key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-mint">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={publicMediaUrl(p.storage_path) ?? ''} alt="" className="h-full w-full object-cover" loading="lazy" />
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(p.id)}
              className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-white/90"
              aria-label={t('removePhoto')}
            >
              <Icon name="close" size={14} />
            </button>
          </figure>
        ))}
        {photos.length < 8 ? (
          <label
            className={`grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line text-sprout-deep ${busy ? 'opacity-50' : ''}`}
          >
            <Icon name="camera" size={22} />
            <span className="sr-only">{t('addPhoto')}</span>
            <input type="file" accept="image/*" multiple className="sr-only" disabled={busy} onChange={(e) => add(e.target.files)} />
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Quick stock edit beside the price editor. */
export function StockEditor({ listingId, quantity, label }: { listingId: string; quantity: number | null; label: string }) {
  const t = useTranslations('myFarmPlus');
  const [value, setValue] = useState(quantity === null ? '' : String(Math.round(quantity)));
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const changed = value !== (quantity === null ? '' : String(Math.round(quantity)));
  return (
    <form
      className="flex items-center gap-2 pb-2.5 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateListingQuantity(listingId, value === '' ? null : Number(value));
          setSaved(r.ok);
          if (r.ok) track('listing.quantity_changed', { listing: listingId, quantity: value === '' ? null : Number(value) });
        });
      }}
    >
      <label htmlFor={`qty-${listingId}`} className="text-soil">
        {t('stock')}
      </label>
      <input
        id={`qty-${listingId}`}
        className="input min-h-11 w-20 px-2 tabular-nums"
        inputMode="numeric"
        value={value}
        aria-label={`${t('stock')}: ${label}`}
        onChange={(e) => {
          setValue(e.target.value.replace(/[^\d]/g, ''));
          setSaved(false);
        }}
      />
      {changed ? (
        <button type="submit" disabled={pending} className="min-h-11 px-2 text-sm font-bold text-sprout-deep">
          {t('saveStock')}
        </button>
      ) : saved ? (
        <Icon name="check" size={16} className="text-sprout-deep" />
      ) : null}
    </form>
  );
}

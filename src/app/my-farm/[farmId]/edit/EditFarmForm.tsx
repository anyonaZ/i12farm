'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { CATEGORY_ICON, Icon } from '@/components/Icon';
import { updateFarm } from '@/domains/farms/actions';
import type { FarmForEdit } from '@/domains/farms/queries';
import type { Visibility } from '@/domains/farms/types';
import type { SubCounty } from '@/domains/reference/queries';

const FarmMap = dynamic(() => import('@/components/map/FarmMap').then((m) => m.FarmMap), { ssr: false });

interface Props {
  farm: FarmForEdit;
  categories: { slug: string; name: string }[];
  counties: { code: number; name: string; focus: [number, number] | null }[];
  subCounties: SubCounty[];
}

export function EditFarmForm({ farm, categories, counties, subCounties }: Props) {
  const t = useTranslations('farmEdit');
  const tw = useTranslations('wizard');
  const router = useRouter();
  const [name, setName] = useState(farm.name);
  const [farmer, setFarmer] = useState(farm.farmer_name ?? '');
  const [desc, setDesc] = useState(farm.description ?? '');
  const [cats, setCats] = useState<string[]>(farm.categories);
  const [county, setCounty] = useState(farm.county_code);
  const [sub, setSub] = useState<number | ''>(farm.sub_county_id ?? '');
  const [place, setPlace] = useState(farm.place_name ?? '');
  const [phone, setPhone] = useState(farm.phone_public ?? '');
  const [wa, setWa] = useState(farm.whatsapp ?? '');
  const [size, setSize] = useState(farm.size_acres === null ? '' : String(farm.size_acres));
  const [year, setYear] = useState(farm.year_started === null ? '' : String(farm.year_started));
  const [vis, setVis] = useState<Visibility>(farm.visibility);
  const start: [number, number] =
    farm.lng !== null && farm.lat !== null ? [farm.lng, farm.lat] : (counties.find((c) => c.code === county)?.focus ?? [36.817, -1.286]);
  const [movePin, setMovePin] = useState(false);
  const [pin, setPin] = useState<[number, number]>(start);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const subs = subCounties.filter((s) => s.county_code === county);

  function save() {
    setError('');
    setSaved(false);
    startTransition(async () => {
      const r = await updateFarm(farm.id, {
        name,
        farmerName: farmer,
        description: desc,
        categories: cats,
        countyCode: county,
        subCountyId: sub === '' ? null : sub,
        placeName: place,
        phone,
        whatsapp: wa,
        sizeAcres: size,
        yearStarted: year,
        visibility: vis,
        lng: movePin ? pin[0] : null,
        lat: movePin ? pin[1] : null,
      });
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(t.has(`errors.${r.error}`) ? t(`errors.${r.error}` as never) : (r.detail ?? r.error));
      }
    });
  }

  return (
    <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-28 pt-6 lg:max-w-2xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-center gap-3">
        <Link
          href={`/my-farm/${farm.id}`}
          className="grid size-11 place-items-center rounded-full border border-line bg-surface"
          aria-label={t('back')}
        >
          <Icon name="back" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">{t('title')}</h1>
          <p className="truncate text-sm text-soil">{farm.name}</p>
        </div>
      </header>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('details')}</h2>
        <Field id="e-name" label={tw('farmName')}>
          <input id="e-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="input" />
        </Field>
        <Field id="e-farmer" label={tw('farmerName')}>
          <input id="e-farmer" value={farmer} onChange={(e) => setFarmer(e.target.value)} maxLength={120} className="input" />
        </Field>
        <Field id="e-desc" label={tw('desc')}>
          <textarea id="e-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} className="input min-h-24 py-3" />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field id="e-phone" label={tw('phone')}>
            <input
              id="e-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
              className="input tabular-nums"
            />
          </Field>
          <Field id="e-wa" label="WhatsApp">
            <input
              id="e-wa"
              type="tel"
              inputMode="tel"
              value={wa}
              onChange={(e) => setWa(e.target.value)}
              placeholder="0712 345 678"
              className="input tabular-nums"
            />
          </Field>
          <Field id="e-size" label={t('size')}>
            <input
              id="e-size"
              inputMode="decimal"
              value={size}
              onChange={(e) => setSize(e.target.value.replace(/[^\d.]/g, ''))}
              className="input tabular-nums"
            />
          </Field>
          <Field id="e-year" label={t('since')}>
            <input
              id="e-year"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="input tabular-nums"
            />
          </Field>
        </div>
      </section>

      <fieldset className="card gap-2">
        <legend className="sr-only">{t('types')}</legend>
        <h2 className="text-lg font-bold" aria-hidden="true">
          {t('types')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = cats.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={on}
                onClick={() => setCats(on ? cats.filter((x) => x !== c.slug) : [...cats, c.slug])}
                className={`chip ${on ? 'border-sprout-deep bg-sprout/10 text-sprout-deep' : ''}`}
              >
                <Icon name={CATEGORY_ICON[c.slug] ?? 'leaf'} size={16} />
                {c.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('where')}</h2>
        <div className="grid grid-cols-2 gap-2.5">
          <Field id="e-county" label={tw('county')}>
            <select
              id="e-county"
              className="input"
              value={county}
              onChange={(e) => {
                setCounty(Number(e.target.value));
                setSub('');
              }}
            >
              {counties.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="e-sub" label={tw('subcounty')}>
            <select id="e-sub" className="input" value={sub} onChange={(e) => setSub(e.target.value ? Number(e.target.value) : '')}>
              <option value="">–</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="e-place" label={tw('place')}>
          <input
            id="e-place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            maxLength={120}
            placeholder={tw('placeHint')}
            className="input"
          />
        </Field>
        {movePin ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold">{tw('moveMap')}</span>
            <FarmMap
              className="h-64 overflow-hidden rounded-2xl border border-line"
              label={tw('moveMap')}
              center={start}
              zoom={14}
              centerPin
              onCenterChange={(lng, lat) => setPin([lng, lat])}
            />
            <span className="font-mono text-xs tabular-nums text-soil">
              {pin[1].toFixed(5)}, {pin[0].toFixed(5)}
            </span>
          </div>
        ) : (
          <button type="button" onClick={() => setMovePin(true)} className="btn-secondary">
            <Icon name="pin" size={18} />
            {t('movePin')}
          </button>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-bold">{tw('visibility')}</legend>
          {(
            [
              ['approximate', 'visApprox', 'visApproxD'],
              ['exact', 'visExact', 'visExactD'],
              ['hidden', 'visHidden', 'visHiddenD'],
            ] as const
          ).map(([v, a, d]) => (
            <label
              key={v}
              className={`flex items-start gap-3 rounded-2xl border bg-surface p-3 ${vis === v ? 'border-sprout-deep' : 'border-line'}`}
            >
              <input
                type="radio"
                name="e-vis"
                value={v}
                checked={vis === v}
                onChange={() => setVis(v)}
                className="mt-0.5 size-5 accent-sprout-deep"
              />
              <span>
                <b className="block text-sm">{tw(a)}</b>
                <span className="text-sm text-soil">{tw(d)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2">
        {error ? (
          <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="rounded-xl bg-mint px-3 py-2.5 text-sm font-semibold">
            {t('saved')}
          </p>
        ) : null}
        <button type="button" onClick={save} disabled={pending} className="btn-primary min-h-14 text-lg shadow-lg">
          {pending ? t('saving') : t('save')}
        </button>
      </div>
    </main>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {children}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Icon, CATEGORY_ICON } from '@/components/Icon';
import { FarmMap } from '@/components/map/FarmMap';
import { compressImage, formatBytes, type CompressedImage } from '@/lib/images';
import { isKenyanMobile } from '@/lib/phone';
import { track } from '@/lib/analytics/track';
import { createFarm } from '@/domains/farms/actions';
import type { Visibility } from '@/domains/farms/types';
import type { Product, SubCounty } from '@/domains/reference/queries';

interface Props {
  isAgent: boolean;
  defaultFarmer: string;
  categories: { slug: string; name: string }[];
  products: Product[];
  counties: { code: number; name: string; focus: [number, number] | null }[];
  subCounties: SubCounty[];
}

interface Item {
  product: string;
  price: string;
  qty: string;
}

const TOTAL = 6;

// Pin your farm (or, for a field agent, enrol a farm) in six short steps:
// details, categories, location, photos, products, review.
export function PinWizard({ isAgent, defaultFarmer, categories, products, counties, subCounties }: Props) {
  const t = useTranslations('wizard');
  const tu = useTranslations('units');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [farmer, setFarmer] = useState(isAgent ? '' : defaultFarmer);
  const [phone, setPhone] = useState('');
  const [waSame, setWaSame] = useState(true);
  const [desc, setDesc] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [county, setCounty] = useState<number>(counties[0]?.code ?? 43);
  const [subId, setSubId] = useState<number | ''>('');
  const [place, setPlace] = useState('');
  const [vis, setVis] = useState<Visibility>('approximate');
  const focus = counties.find((c) => c.code === county)?.focus ?? [34.457, -0.527];
  const [pin, setPin] = useState<[number, number]>(focus);
  const [mapView, setMapView] = useState<{ center: [number, number]; zoom: number; key: number }>({ center: focus, zoom: 11, key: 0 });
  const [photos, setPhotos] = useState<CompressedImage[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const started = useRef(false);
  const [draftFound, setDraftFound] = useState<Draft | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      track('farm.pin_started', { as: isAgent ? 'agent' : 'farmer' });
      const d = readDraft();
      if (d && d.name) setDraftFound(d);
    }
  }, [isAgent]);

  // Keep a draft on the phone after every change (photos excepted: they are
  // re-chosen), so a dropped signal or a closed tab doesn't lose the work.
  useEffect(() => {
    if (!started.current || draftFound || done.current) return;
    if (!name && !cats.length && step === 1) return;
    writeDraft({ step, name, farmer, phone, waSame, desc, cats, county, subId, place, vis, pin, items, savedAt: Date.now() });
  }, [step, name, farmer, phone, waSame, desc, cats, county, subId, place, vis, pin, items, draftFound]);

  // Ask before leaving with unsaved work.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!done.current && (name || cats.length)) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [name, cats]);

  function resumeDraft(d: Draft) {
    setName(d.name);
    setFarmer(d.farmer);
    setPhone(d.phone);
    setWaSame(d.waSame);
    setDesc(d.desc);
    setCats(d.cats);
    setCounty(d.county);
    setSubId(d.subId);
    setPlace(d.place);
    setVis(d.vis);
    setPin(d.pin);
    setMapView((v) => ({ center: d.pin, zoom: 14, key: v.key + 1 }));
    setItems(d.items);
    setStep(Math.min(Math.max(1, d.step), TOTAL));
    setDraftFound(null);
  }

  const offered = useMemo(() => products.filter((p) => cats.includes(p.category)), [products, cats]);
  const subs = subCounties.filter((s) => s.county_code === county);
  const title = isAgent ? t('enrolTitle') : t('pinTitle');

  function validate(): string {
    if (step === 1) {
      if (!name.trim() || !farmer.trim() || !phone.trim()) return t('err1');
      if (!isKenyanMobile(phone)) return t('errPhone');
    }
    if (step === 2 && cats.length === 0) return t('err2');
    if (step === 3 && !subId) return t('err3');
    if (step === 5 && !items.some((i) => i.product && Number(i.price) > 0)) return t('err5');
    return '';
  }

  function next() {
    const problem = validate();
    setError(problem);
    if (problem) return;
    track('farm.pin_step_completed', { step });
    if (step === 4 && items.length === 0 && offered[0]) setItems([{ product: offered[0].slug, price: '', qty: '' }]);
    if (step < TOTAL) setStep(step + 1);
    else publish();
  }

  function publish() {
    startTransition(async () => {
      const result = await createFarm({
        name,
        farmer_name: farmer,
        phone,
        whatsapp_same: waSame,
        description: desc,
        categories: cats,
        county_code: county,
        sub_county_id: subId || null,
        place_name: place,
        visibility: vis,
        lng: pin[0],
        lat: pin[1],
        for_farmer: isAgent,
        listings: items
          .filter((i) => i.product && Number(i.price) > 0)
          .map((i) => ({ product_slug: i.product, price_kes: Number(i.price), quantity: i.qty ? Number(i.qty) : null })),
      });
      if (!result.ok) {
        setError(t('errSave', { reason: result.error }));
        return;
      }
      const { id, slug } = result.data;
      done.current = true;
      clearDraft();

      // Photos were shrunk on this phone; each one is a small upload to our server.
      if (photos.length) {
        let failed = 0;
        for (const p of photos) {
          const form = new FormData();
          form.set('file', p.blob, p.blob.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
          form.set('width', String(p.width));
          form.set('height', String(p.height));
          const response = await fetch(`/api/farms/${id}/photos`, { method: 'POST', body: form }).catch(() => null);
          if (!response?.ok) failed += 1;
        }
        if (failed) {
          router.push(`/my-farm?photosFailed=${failed}`);
          return;
        }
      }
      router.push(`/f/${slug}`);
    });
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = 4 - photos.length;
    const done: CompressedImage[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      try {
        done.push(await compressImage(f));
      } catch {
        // unreadable file: skip it
      }
    }
    setPhotos((p) => [...p, ...done]);
  }

  function chooseCounty(code: number) {
    setCounty(code);
    setSubId('');
    const f = counties.find((c) => c.code === code)?.focus;
    if (f) {
      setPin(f);
      setMapView((v) => ({ center: f, zoom: 11, key: v.key + 1 }));
    }
  }

  function locateMe() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const p: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setPin(p);
        setMapView((v) => ({ center: p, zoom: 15, key: v.key + 1 }));
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const catLabel = (s: string) => categories.find((c) => c.slug === s)?.name ?? s;
  const productLabel = (s: string) => products.find((p) => p.slug === s);

  return (
    <div className="flex min-h-dvh flex-col lg:mx-auto lg:min-h-[calc(100dvh-4rem)] lg:w-full lg:max-w-2xl lg:border-x lg:border-line lg:bg-mint lg:pb-0">
      <div className="sticky top-0 z-20 border-b border-line bg-surface px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] lg:top-16 lg:px-8">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => (step === 1 ? router.back() : (setError(''), setStep(step - 1)))}
            className="grid size-11 place-items-center rounded-full border border-line"
            aria-label={step === 1 ? t('close') : t('back')}
          >
            <Icon name={step === 1 ? 'close' : 'back'} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
          <span className="text-sm tabular-nums text-soil">{t('step', { a: step, b: TOTAL })}</span>
        </div>
        <div className="mt-2.5 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL }, (_, i) => (
            <i key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-sprout' : 'bg-line'}`} />
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 py-5 lg:px-8 lg:py-8">
        {error ? (
          <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
            {error}
          </p>
        ) : null}

        {draftFound ? (
          <section className="flex flex-col gap-2 rounded-2xl border border-sprout-deep bg-sprout/10 p-4" role="status">
            <p className="font-bold">{t('draftFound', { name: draftFound.name })}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => resumeDraft(draftFound)} className="btn-primary min-h-11 w-auto px-5 text-sm">
                {t('draftResume')}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearDraft();
                  setDraftFound(null);
                }}
                className="btn-secondary min-h-11 w-auto px-5 text-sm"
              >
                {t('draftDiscard')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <>
            <h2 className="text-2xl font-extrabold">{t('s1')}</h2>
            <Field id="w-name" label={t('farmName')}>
              <input
                id="w-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('farmNameHint')}
                maxLength={80}
              />
            </Field>
            <Field id="w-farmer" label={t('farmerName')}>
              <input
                id="w-farmer"
                className="input"
                value={farmer}
                onChange={(e) => setFarmer(e.target.value)}
                autoComplete="name"
                maxLength={120}
              />
            </Field>
            <Field id="w-phone" label={t('phone')}>
              <input
                id="w-phone"
                className="input tabular-nums"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0712 345 678"
                autoComplete="tel"
              />
            </Field>
            <label className="flex min-h-11 items-center gap-2.5 text-sm">
              <input type="checkbox" checked={waSame} onChange={(e) => setWaSame(e.target.checked)} className="size-5 accent-sprout-deep" />
              {t('waSame')}
            </label>
            <Field id="w-desc" label={t('desc')}>
              <textarea
                id="w-desc"
                className="input min-h-24 py-3"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={t('descHint')}
                maxLength={2000}
              />
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-2xl font-extrabold">{t('s2')}</h2>
            <p className="text-soil">{t('s2hint')}</p>
            <div className="grid grid-cols-2 gap-2">
              {categories.map((c) => {
                const on = cats.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setCats(on ? cats.filter((x) => x !== c.slug) : [...cats, c.slug]);
                      setItems([]);
                    }}
                    className={`flex min-h-14 items-center gap-2.5 rounded-2xl border px-3 text-left text-sm font-semibold ${
                      on ? 'border-sprout-deep bg-sprout/10 shadow-[inset_0_0_0_1px_var(--color-sprout-deep)]' : 'border-line bg-surface'
                    }`}
                  >
                    <Icon name={CATEGORY_ICON[c.slug] ?? 'leaf'} size={22} className="shrink-0 text-sprout-deep" />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="text-2xl font-extrabold">{t('s3')}</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <Field id="w-county" label={t('county')}>
                <select id="w-county" className="input" value={county} onChange={(e) => chooseCounty(Number(e.target.value))}>
                  {counties.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="w-sub" label={t('subcounty')}>
                <select id="w-sub" className="input" value={subId} onChange={(e) => setSubId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">–</option>
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="w-place" label={t('place')}>
              <input
                id="w-place"
                className="input"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder={t('placeHint')}
                maxLength={120}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{t('moveMap')}</span>
                <button type="button" onClick={locateMe} className="shrink-0 text-sm font-bold text-sprout-deep">
                  {t('useLocation')}
                </button>
              </div>
              <FarmMap
                className="h-64 overflow-hidden rounded-2xl border border-line"
                label={t('moveMap')}
                center={mapView.center}
                zoom={mapView.zoom}
                flyKey={mapView.key}
                centerPin
                onCenterChange={(lng, lat) => setPin([lng, lat])}
              />
              <span className="font-mono text-xs tabular-nums text-soil">
                {pin[1].toFixed(5)}, {pin[0].toFixed(5)}
              </span>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-bold">{t('visibility')}</legend>
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
                    name="w-vis"
                    value={v}
                    checked={vis === v}
                    onChange={() => setVis(v)}
                    className="mt-0.5 size-5 accent-sprout-deep"
                  />
                  <span>
                    <b className="block text-sm">{t(a)}</b>
                    <span className="text-sm text-soil">{t(d)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h2 className="text-2xl font-extrabold">{t('s4')}</h2>
            <p className="text-soil">{t('s4hint')}</p>
            <div className="grid grid-cols-2 gap-2">
              {photos.map((p, i) => (
                <figure key={p.previewUrl} className="relative aspect-square overflow-hidden rounded-2xl bg-mint">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  <figcaption className="absolute bottom-1.5 left-1.5 rounded bg-white/85 px-1.5 font-mono text-xs">
                    {formatBytes(p.originalBytes)} → {formatBytes(p.blob.size)}
                  </figcaption>
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-white/85"
                    aria-label={t('removePhoto')}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </figure>
              ))}
              {photos.length < 4 ? (
                <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line p-4 text-center font-bold text-sprout-deep">
                  <Icon name="camera" size={28} />
                  {t('choose')}
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              ) : null}
            </div>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <h2 className="text-2xl font-extrabold">{t('s5')}</h2>
            <p className="text-soil">{t('s5hint')}</p>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-line bg-surface p-3">
                <Field id={`w-p${i}`} label={t('product')}>
                  <select
                    id={`w-p${i}`}
                    className="input"
                    value={it.product}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, product: e.target.value } : x)))}
                  >
                    {offered.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name} ({tu(p.unit)})
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  className="grid size-11 place-items-center self-end rounded-full border border-line"
                  aria-label={t('remove')}
                >
                  <Icon name="close" />
                </button>
                <div className="col-span-2 grid grid-cols-2 gap-2.5">
                  <Field id={`w-pr${i}`} label={t('price')}>
                    <input
                      id={`w-pr${i}`}
                      className="input tabular-nums"
                      inputMode="numeric"
                      value={it.price}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value.replace(/[^\d]/g, '') } : x)))}
                    />
                  </Field>
                  <Field id={`w-q${i}`} label={t('qty')}>
                    <input
                      id={`w-q${i}`}
                      className="input tabular-nums"
                      inputMode="numeric"
                      value={it.qty}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^\d]/g, '') } : x)))}
                    />
                  </Field>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setItems([...items, { product: offered[0]?.slug ?? '', price: '', qty: '' }])}
            >
              <Icon name="plus" size={18} />
              {t('addProduct')}
            </button>
          </>
        ) : null}

        {step === 6 ? (
          <>
            <h2 className="text-2xl font-extrabold">{t('review')}</h2>
            <dl className="card divide-y divide-line p-0 text-sm">
              <Row label={t('farmName')} value={name} />
              <Row label={t('farmerName')} value={farmer} />
              <Row label={t('phone')} value={phone} />
              <Row label={t('s2')} value={cats.map(catLabel).join(', ')} />
              <Row
                label={t('county')}
                value={[place, subs.find((s) => s.id === subId)?.name, counties.find((c) => c.code === county)?.name]
                  .filter(Boolean)
                  .join(', ')}
              />
              <Row label={t('visibility')} value={t(vis === 'approximate' ? 'visApprox' : vis === 'exact' ? 'visExact' : 'visHidden')} />
              {items
                .filter((i) => Number(i.price) > 0)
                .map((i, k) => {
                  const p = productLabel(i.product);
                  return (
                    <Row
                      key={k}
                      label={p?.name ?? i.product}
                      value={`KES ${Number(i.price).toLocaleString('en-KE')} / ${p ? tu(p.unit) : ''}`}
                    />
                  );
                })}
            </dl>
          </>
        ) : null}
      </div>

      <div className="sticky bottom-0 z-20 flex gap-2.5 border-t border-line bg-surface px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 lg:px-8">
        {step === 4 && photos.length === 0 ? (
          <button type="button" className="btn-secondary w-auto px-6" onClick={next}>
            {t('skip')}
          </button>
        ) : null}
        <button type="button" className="btn-primary flex-1" onClick={next} disabled={pending}>
          {step === TOTAL ? (pending ? t('publishing') : t('publish')) : t('next')}
        </button>
      </div>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-2.5">
      <dt className="text-soil">{label}</dt>
      <dd className="min-w-0 text-right font-bold">{value}</dd>
    </div>
  );
}

interface Draft {
  step: number;
  name: string;
  farmer: string;
  phone: string;
  waSame: boolean;
  desc: string;
  cats: string[];
  county: number;
  subId: number | '';
  place: string;
  vis: Visibility;
  pin: [number, number];
  items: Item[];
  savedAt: number;
}

const DRAFT_KEY = 'i12f-pin-draft';
const DRAFT_DAYS = 14;

function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    if (!d || Date.now() - d.savedAt > DRAFT_DAYS * 86_400_000) return null;
    return d;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // storage full or blocked: the wizard still works, just without a draft
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

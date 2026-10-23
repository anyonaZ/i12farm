'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { requestVet } from '@/domains/vets/actions';
import { CATEGORY_ICON, Icon } from '@/components/Icon';

interface Props {
  counties: { code: number; name: string }[];
  animals: { slug: string; name: string }[];
  defaultCounty: number | null;
  defaultPhone: string;
}

export function VetRequestForm({ counties, animals, defaultCounty, defaultPhone }: Props) {
  const t = useTranslations('vets');
  const router = useRouter();
  const [county, setCounty] = useState(String(defaultCounty ?? ''));
  const [place, setPlace] = useState('');
  const [animal, setAnimal] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<'today' | 'this_week'>('today');
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const ready = county && animal;

  function submit() {
    setMessage(null);
    start(async () => {
      const res = await requestVet({ countyCode: Number(county), place, animal, description, urgency, phone });
      if (res.ok) {
        setMessage({ ok: true, text: t('sent', { number: res.data.number, vets: res.data.vets }) });
        setPlace('');
        setDescription('');
        setAnimal('');
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error === 'phone' ? t('noPhone') : t('error', { detail: res.detail ?? res.error }) });
      }
    });
  }

  return (
    <section className="card gap-4">
      <h2 className="text-lg font-bold">{t('request')}</h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-bold">{t('animal')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {animals.map((a) => (
            <button
              key={a.slug}
              type="button"
              onClick={() => setAnimal(a.slug)}
              aria-pressed={animal === a.slug}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-sm font-semibold ${
                animal === a.slug ? 'border-sprout-deep bg-sprout/10 text-sprout-deep' : 'border-line'
              }`}
            >
              <Icon name={CATEGORY_ICON[a.slug] ?? 'paw'} size={20} />
              {a.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="vet-problem" className="text-sm font-bold">
          {t('problem')}
        </label>
        <textarea
          id="vet-problem"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder={t('problemHint')}
          className="input min-h-20 py-3"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="vet-county" className="text-sm font-bold">
            {t('county')}
          </label>
          <select id="vet-county" value={county} onChange={(e) => setCounty(e.target.value)} className="input">
            <option value="">—</option>
            {counties.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="vet-place" className="text-sm font-bold">
            {t('place')}
          </label>
          <input
            id="vet-place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            maxLength={120}
            placeholder={t('placeHint')}
            className="input"
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-bold">{t('when')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['today', 'this_week'] as const).map((u) => (
            <label
              key={u}
              className={`flex items-center gap-2 rounded-2xl border p-3 text-sm font-semibold ${urgency === u ? 'border-sprout-deep' : 'border-line'}`}
            >
              <input
                type="radio"
                name="vet-urgency"
                checked={urgency === u}
                onChange={() => setUrgency(u)}
                className="size-5 accent-sprout-deep"
              />
              {t(u === 'today' ? 'today' : 'thisWeek')}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="vet-phone" className="text-sm font-bold">
          {t('phone')}
        </label>
        <input
          id="vet-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0712 345 678"
          autoComplete="tel"
          className="input tabular-nums"
        />
      </div>

      {message ? (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${message.ok ? 'bg-mint' : 'bg-amber/15'}`}
        >
          {message.text}
        </p>
      ) : null}
      <button type="button" onClick={submit} disabled={!ready || pending} className="btn-primary min-h-14 text-lg">
        <Icon name="send" size={20} />
        {pending ? t('sending') : t('send')}
      </button>
    </section>
  );
}

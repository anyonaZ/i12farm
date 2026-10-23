'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createBroadcast, previewAudience, withdrawBroadcast } from '@/domains/broadcasts/actions';
import type { Audience } from '@/domains/broadcasts/queries';
import { Icon } from '@/components/Icon';

interface Props {
  counties: { code: number; name: string }[];
  categories: { slug: string; name: string }[];
  organisation: string;
}

// The SMS is "<organisation>: <message> Reply STOP to stop." in each farmer's language.
const STOP_EN = ' Reply STOP to stop.';
const STOP_SW = ' Jibu STOP kusitisha.';

function parts(text: string): number {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

export function BroadcastComposer({ counties, categories, organisation: initialOrg }: Props) {
  const t = useTranslations('partner');
  const router = useRouter();
  const [organisation, setOrganisation] = useState(initialOrg);
  const [bodyEn, setBodyEn] = useState('');
  const [bodySw, setBodySw] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [aud, setAud] = useState<Audience | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const res = await previewAudience(picked, cats, verifiedOnly);
      if (live && res.ok) setAud(res.data);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [picked, cats, verifiedOnly]);

  const toggle = <V,>(list: V[], v: V) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const fullEn = `${organisation}: ${bodyEn}${STOP_EN}`;
  const fullSw = `${organisation}: ${bodySw}${STOP_SW}`;
  const tooMany = aud ? aud.phones > aud.max : false;
  const ready =
    organisation.trim().length >= 2 && bodyEn.trim().length >= 10 && bodySw.trim().length >= 10 && (aud?.reach ?? 0) > 0 && !tooMany;

  function submit() {
    setMessage(null);
    start(async () => {
      const res = await createBroadcast({ organisation, bodyEn, bodySw, counties: picked, categories: cats, verifiedOnly });
      if (res.ok) {
        setMessage({ ok: true, text: t('submitted') });
        setBodyEn('');
        setBodySw('');
        router.refresh();
      } else setMessage({ ok: false, text: t('error', { detail: res.detail ?? res.error }) });
    });
  }

  return (
    <section className="card gap-4">
      <h2 className="text-lg font-bold">{t('new')}</h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="b-org" className="text-sm font-bold">
          {t('organisation')}
        </label>
        <input id="b-org" value={organisation} onChange={(e) => setOrganisation(e.target.value)} maxLength={60} className="input" />
      </div>
      {(
        [
          ['b-en', 'bodyEn', bodyEn, setBodyEn, fullEn],
          ['b-sw', 'bodySw', bodySw, setBodySw, fullSw],
        ] as const
      ).map(([id, label, value, set, full]) => (
        <div key={id} className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-bold">
            {t(label)}
          </label>
          <textarea id={id} value={value} onChange={(e) => set(e.target.value)} maxLength={300} className="input min-h-24 py-3" />
          <span className="text-xs text-soil tabular-nums">{t('chars', { count: full.length, parts: parts(full) })}</span>
        </div>
      ))}
      <p className="text-xs text-soil">{t('stopNote')}</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">{t('counties')}</legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPicked([])}
            aria-pressed={!picked.length}
            className={`chip ${!picked.length ? 'border-sprout-deep bg-sprout/10' : ''}`}
          >
            {t('allCounties')}
          </button>
          {counties.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setPicked(toggle(picked, c.code))}
              aria-pressed={picked.includes(c.code)}
              className={`chip ${picked.includes(c.code) ? 'border-sprout-deep bg-sprout/10' : ''}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">{t('categories')}</legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCats([])}
            aria-pressed={!cats.length}
            className={`chip ${!cats.length ? 'border-sprout-deep bg-sprout/10' : ''}`}
          >
            {t('allCategories')}
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => setCats(toggle(cats, c.slug))}
              aria-pressed={cats.includes(c.slug)}
              className={`chip ${cats.includes(c.slug) ? 'border-sprout-deep bg-sprout/10' : ''}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={verifiedOnly}
          onChange={(e) => setVerifiedOnly(e.target.checked)}
          className="size-5 accent-sprout-deep"
        />
        {t('verifiedOnly')}
      </label>

      {aud ? (
        <p className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${tooMany ? 'bg-amber/15' : 'bg-mint'}`} aria-live="polite">
          {tooMany ? t('tooMany', { max: aud.max }) : t('audience', { reach: aud.reach, optedOut: aud.opted_out, cost: aud.cost_kes })}
        </p>
      ) : null}
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
        {t('submit')}
      </button>
    </section>
  );
}

export function WithdrawButton({ id }: { id: string }) {
  const t = useTranslations('partner');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await withdrawBroadcast(id);
          router.refresh();
        })
      }
      className="self-start text-sm font-semibold text-soil underline"
    >
      {t('withdraw')}
    </button>
  );
}

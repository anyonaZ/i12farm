'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { FarmCover } from '@/components/farm/FarmCover';
import type { ManagedFarmRow } from '@/domains/farms/queries';

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '');

/** Agents manage dozens of farms: a searchable list, one tap to a farm's tools. */
export function FarmList({ farms }: { farms: ManagedFarmRow[] }) {
  const t = useTranslations('farmEdit');
  const [q, setQ] = useState('');
  const [county, setCounty] = useState('');
  const [filter, setFilter] = useState<'all' | 'unclaimed' | 'paused' | 'orders'>('all');
  const counties = useMemo(() => [...new Set(farms.map((f) => f.county_name))].sort(), [farms]);
  const shown = farms.filter((f) => {
    if (county && f.county_name !== county) return false;
    if (filter === 'unclaimed' && f.claimed) return false;
    if (filter === 'paused' && f.status === 'published') return false;
    if (filter === 'orders' && f.need_action === 0) return false;
    const words = fold(q).split(/\s+/).filter(Boolean);
    const hay = fold([f.name, f.farmer_name, f.place_name, f.county_name].join(' '));
    return words.every((w) => hay.includes(w));
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="fl-q" className="sr-only">
          {t('searchFarms')}
        </label>
        <input
          id="fl-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchFarms')}
          className="input flex-1"
        />
        <label htmlFor="fl-county" className="sr-only">
          {t('county')}
        </label>
        <select id="fl-county" value={county} onChange={(e) => setCounty(e.target.value)} className="input sm:w-48">
          <option value="">{t('allCounties')}</option>
          {counties.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" role="group" aria-label={t('filter')}>
        {(['all', 'orders', 'unclaimed', 'paused'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={`chip ${filter === k ? 'border-forest bg-forest text-white' : ''}`}
          >
            {t(`filters.${k}`)}
          </button>
        ))}
      </div>
      <p className="text-sm text-soil">{t('showing', { n: shown.length, total: farms.length })}</p>
      <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2">
        {shown.map((f) => (
          <li key={f.id}>
            <Link href={`/my-farm/${f.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:bg-mint">
              <span className="size-12 shrink-0 overflow-hidden rounded-xl">
                <FarmCover id={f.id} name={f.name} category={f.categories[0]} coverPath={f.cover_path ?? undefined} sizes="48px" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{f.name}</span>
                <span className="block truncate text-sm text-soil">
                  {[f.place_name, f.county_name].filter(Boolean).join(' · ')} · {t('productsCount', { n: f.products })}
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {f.need_action ? (
                    <span className="rounded-full bg-sprout-deep px-2 py-0.5 text-xs font-bold text-white">
                      {t('ordersWaiting', { n: f.need_action })}
                    </span>
                  ) : null}
                  {!f.claimed ? <span className="rounded-full bg-mint px-2 py-0.5 text-xs font-bold">{t('unclaimed')}</span> : null}
                  {f.status !== 'published' ? (
                    <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold">{t('pausedPill')}</span>
                  ) : null}
                </span>
              </span>
              <Icon name="back" size={18} className="shrink-0 rotate-180 text-soil" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

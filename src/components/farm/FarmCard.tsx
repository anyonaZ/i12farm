'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/Icon';
import { kes } from '@/lib/format';
import type { FarmSummary } from '@/domains/farms/types';
import { FarmCover } from './FarmCover';

export function FarmCard({
  farm,
  categoryName,
  layout,
  selected,
}: {
  farm: FarmSummary;
  categoryName: (slug: string) => string;
  layout: 'compact' | 'wide';
  selected?: boolean;
}) {
  const t = useTranslations();
  const price =
    farm.min_price_kes !== null ? (
      <span className="font-bold tabular-nums">
        {kes(farm.min_price_kes)}{' '}
        <small className="font-medium text-soil">{t('farm.per', { unit: t(`units.${farm.min_price_unit ?? 'kg'}`) })}</small>
      </span>
    ) : (
      <span className="text-sm text-soil">{t('farm.onRequest')}</span>
    );
  const place = [farm.place_name, farm.county_name].filter(Boolean).join(' · ');

  if (layout === 'compact') {
    return (
      <Link
        href={`/f/${farm.slug}`}
        className={`flex w-[78%] max-w-80 shrink-0 snap-start gap-3 rounded-2xl border bg-surface p-2.5 ${
          selected ? 'border-sprout shadow-[inset_0_0_0_2px_var(--color-sprout)]' : 'border-line'
        }`}
      >
        <span className="aspect-square w-23 shrink-0 overflow-hidden rounded-xl">
          <FarmCover id={farm.id} name={farm.name} category={farm.categories[0]} coverPath={farm.cover_path} sizes="92px" />
        </span>
        <span className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="truncate font-bold">{farm.name}</span>
          <span className="truncate text-sm text-soil">{place}</span>
          <span className="truncate text-sm text-soil">{farm.categories.map(categoryName).join(', ')}</span>
          {price}
          {farm.verified ? <VerifiedBadge label={t('farm.verified')} /> : null}
        </span>
      </Link>
    );
  }

  return (
    <Link href={`/f/${farm.slug}`} className="flex flex-col gap-2.5">
      <span className="relative block aspect-[16/10] overflow-hidden rounded-2xl">
        <FarmCover id={farm.id} name={farm.name} category={farm.categories[0]} coverPath={farm.cover_path} />
        {farm.verified ? (
          <span className="absolute left-2.5 top-2.5">
            <VerifiedBadge label={t('farm.verified')} />
          </span>
        ) : null}
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-base font-bold">{farm.name}</span>
        {price}
      </span>
      <span className="-mt-1.5 text-sm text-soil">
        {place}
        {farm.lng === null ? ` · ${t('explore.hiddenOnMap')}` : ''}
      </span>
      <span className="-mt-1.5 text-sm text-soil">
        {farm.categories.map(categoryName).join(' · ')} · {t('farm.products', { n: farm.listing_count })}
      </span>
    </Link>
  );
}

export function VerifiedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-xs font-bold text-forest">
      <Icon name="check" size={12} />
      {label}
    </span>
  );
}

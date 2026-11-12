'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icon } from '@/components/Icon';

// The map library is about 1 MB of script. On a farm page most buyers only
// need Directions, so the map loads when they ask for it (data bundles cost money).
const FarmMap = dynamic(() => import('@/components/map/FarmMap').then((m) => m.FarmMap), {
  ssr: false,
  loading: () => <div className="h-44 animate-pulse rounded-2xl border border-line bg-mint" />,
});

export function FarmMiniMap({
  id,
  lng,
  lat,
  exact,
  verified,
  label,
}: {
  id: string;
  lng: number;
  lat: number;
  exact: boolean;
  verified: boolean;
  label: string;
}) {
  const t = useTranslations('farm');
  const [show, setShow] = useState(false);
  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="relative flex h-44 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-line bg-mint text-forest"
        aria-label={`${t('showMap')}: ${label}`}
      >
        <svg className="absolute inset-0 h-full w-full opacity-40" aria-hidden="true">
          <defs>
            <pattern id="mini-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M28 0H0V28" fill="none" stroke="var(--color-line)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#mini-grid)" />
        </svg>
        <Icon name="pin" size={34} className="relative text-sprout-deep" />
        <span className="relative rounded-full bg-surface px-4 py-2 text-sm font-bold shadow-sm">{t('showMap')}</span>
      </button>
    );
  }
  return (
    <FarmMap
      className="h-44 overflow-hidden rounded-2xl border border-line"
      label={label}
      center={[lng, lat]}
      zoom={exact ? 13 : 12}
      interactive={false}
      points={[{ id, lng, lat, verified }]}
      selectedId={id}
    />
  );
}

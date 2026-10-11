'use client';

import { FarmMap } from '@/components/map/FarmMap';

export function FarmMiniMap({ id, lng, lat, exact, verified, label }: { id: string; lng: number; lat: number; exact: boolean; verified: boolean; label: string }) {
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

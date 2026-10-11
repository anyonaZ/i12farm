'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics/track';

export function FarmViewTracker({ farmId }: { farmId: string }) {
  useEffect(() => {
    track('farm.viewed', { farm: farmId });
  }, [farmId]);
  return null;
}

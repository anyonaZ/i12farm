'use client';

import { useSyncExternalStore } from 'react';

/** True when the CSS media query matches; false during server render. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's lg breakpoint: laptops and desktops get the wide layout. */
export const DESKTOP = '(min-width: 1024px)';

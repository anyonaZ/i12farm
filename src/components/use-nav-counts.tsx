'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export type NavCounts = { orders?: number; inbox?: number; vets?: number };

let shared: NavCounts = {};
let last = 0;
const listeners = new Set<(c: NavCounts) => void>();

async function refresh(force = false) {
  if (!force && Date.now() - last < 15_000) return;
  last = Date.now();
  try {
    const r = await fetch('/api/me/counts', { cache: 'no-store' });
    if (!r.ok) return;
    shared = (await r.json()) as NavCounts;
    listeners.forEach((l) => l(shared));
  } catch {
    // offline: keep the last numbers
  }
}

/** Badge numbers for the tab bars, refreshed on navigation and every minute while the app is open. */
export function useNavCounts(): NavCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavCounts>(shared);
  useEffect(() => {
    listeners.add(setCounts);
    return () => {
      listeners.delete(setCounts);
    };
  }, []);
  useEffect(() => {
    refresh(true);
  }, [pathname]);
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && refresh(), 60_000);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return counts;
}

export function Badge({ n, label }: { n: number | undefined; label: string }) {
  if (!n) return null;
  return (
    <span
      className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-amber px-1 text-xs font-bold leading-[18px] text-forest ring-2 ring-surface"
      aria-label={label}
    >
      {n > 9 ? '9+' : n}
    </span>
  );
}

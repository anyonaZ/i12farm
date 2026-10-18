'use client';

import { useSyncExternalStore } from 'react';

// The cart lives on the phone (localStorage), one farm at a time, so it
// survives a dropped connection and needs no account until checkout.
// Prices here are only for display: checkout re-prices everything on the server.

export interface CartLine {
  qty: number;
  price: number;
  title: string;
  unit: string;
  max: number | null;
  booking?: boolean; // training or farm tour: checkout asks for a visit date
}

export interface Cart {
  farmId: string;
  farmSlug: string;
  farmName: string;
  lines: Record<string, CartLine>; // listing id → line
}

const KEY = 'i12f_cart';
const listeners = new Set<() => void>();
let cached: Cart | null | undefined;

function read(): Cart | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Cart | null;
    return value && typeof value === 'object' && value.lines ? value : null;
  } catch {
    return null;
  }
}

function snapshot(): Cart | null {
  if (cached === undefined) cached = read();
  return cached;
}

function write(cart: Cart | null) {
  cached = cart && Object.keys(cart.lines).length > 0 ? cart : null;
  try {
    if (cached) localStorage.setItem(KEY, JSON.stringify(cached));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the cart still works for this page view
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = read();
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCart(): Cart | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export function cartTotals(cart: Cart | null): { items: number; total: number } {
  if (!cart) return { items: 0, total: 0 };
  return Object.values(cart.lines).reduce((acc, l) => ({ items: acc.items + l.qty, total: acc.total + l.qty * l.price }), {
    items: 0,
    total: 0,
  });
}

export function setLine(farm: { id: string; slug: string; name: string }, listingId: string, line: CartLine | null): void {
  const current = snapshot();
  const base: Cart =
    current && current.farmId === farm.id
      ? { ...current, lines: { ...current.lines } }
      : { farmId: farm.id, farmSlug: farm.slug, farmName: farm.name, lines: {} };
  if (!line || line.qty <= 0) delete base.lines[listingId];
  else base.lines[listingId] = { ...line, qty: Math.min(line.qty, line.max ?? 10000) };
  write(base);
}

export function replaceLines(lines: Record<string, CartLine>): void {
  const current = snapshot();
  if (current) write({ ...current, lines });
}

export function clearCart(): void {
  write(null);
}

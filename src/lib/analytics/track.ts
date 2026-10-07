'use client';

import { appVersion } from '@/lib/env';
import { MAX_BATCH, type ClientEvent, type EventBatch, type EventName, type EventProperties } from './events';

// Tiny first-party tracker: queues events in memory and sends them in one
// small request every few seconds, or with sendBeacon when the page hides.
// No third-party scripts, no cookies; ids live in localStorage/sessionStorage.

const AID_KEY = 'i12f_aid';
const SID_KEY = 'i12f_sid';
const FLUSH_MS = 5000;

let queue: ClientEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storedId(storage: Storage | undefined, key: string): string {
  try {
    if (!storage) return randomId();
    let id = storage.getItem(key);
    if (!id) {
      id = randomId();
      storage.setItem(key, id);
    }
    return id;
  } catch {
    return randomId(); // private mode or storage blocked
  }
}

function currentLocale(): 'en' | 'sw' {
  return document.documentElement.lang === 'sw' ? 'sw' : 'en';
}

function batch(events: ClientEvent[]): EventBatch {
  return {
    anonymous_id: storedId(typeof localStorage === 'undefined' ? undefined : localStorage, AID_KEY),
    session_id: storedId(typeof sessionStorage === 'undefined' ? undefined : sessionStorage, SID_KEY),
    locale: currentLocale(),
    app_version: appVersion,
    events,
  };
}

export function flush(useBeacon = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) {
    const chunk = queue.splice(0, MAX_BATCH);
    const body = JSON.stringify(batch(chunk));
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // Offline: put the events back and try again later.
        queue = chunk.concat(queue).slice(0, 200);
      });
    }
  }
}

export function track(name: EventName, properties?: EventProperties): void {
  if (typeof window === 'undefined') return;
  queue.push({ name, occurred_at: new Date().toISOString(), path: location.pathname, properties });
  if (queue.length > 200) queue = queue.slice(-200);

  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });
    window.addEventListener('online', () => flush());
  }
  if (!timer) timer = setTimeout(() => flush(), FLUSH_MS);
}

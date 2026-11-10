'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { removePushSubscription, savePushPrefs, savePushSubscription, sendTestPush, type PushPrefs } from '@/domains/identity/push-actions';

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
type State = 'loading' | 'unsupported' | 'notConfigured' | 'blocked' | 'off' | 'on';

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/**
 * "Notifications on this phone": asks the browser for permission, subscribes
 * through the service worker and saves the subscription. `compact` = a single
 * call-to-action card (My Farm, Vets); otherwise the full settings (Account).
 */
export function PushToggle({ prefs, compact, prompt }: { prefs?: PushPrefs; compact?: boolean; prompt?: string }) {
  const t = useTranslations('notify');
  const [state, setState] = useState<State>('loading');
  const [topics, setTopics] = useState<PushPrefs>(prefs ?? { orders: true, messages: true, vets: true, payouts: true });
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      if (!PUBLIC_KEY) return setState('notConfigured');
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  const turnOn = () =>
    start(async () => {
      setMessage('');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState(permission === 'denied' ? 'blocked' : 'off');
      try {
        const reg = await registration();
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) }));
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        const r = await savePushSubscription(
          { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
          navigator.userAgent,
        );
        if (!r.ok) return setMessage(t('error', { reason: r.error }));
        setState('on');
      } catch (error) {
        console.warn('push subscribe failed', error);
        setMessage(t('subscribeFailed'));
      }
    });

  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe().catch(() => false);
      }
      setState('off');
    });

  const test = () =>
    start(async () => {
      const r = await sendTestPush();
      setMessage(r.ok ? t('testSent') : t('error', { reason: r.error }));
    });

  const toggleTopic = (k: keyof PushPrefs) =>
    start(async () => {
      const next = { ...topics, [k]: !topics[k] };
      setTopics(next);
      const r = await savePushPrefs(next);
      setMessage(r.ok ? t('saved') : t('error', { reason: r.error }));
    });

  if (state === 'loading') return null;
  if (compact) {
    if (state !== 'off') return null; // only ask when it would help
    return (
      <button
        type="button"
        onClick={turnOn}
        disabled={pending}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-lime/40 px-3.5 text-left text-sm font-bold"
      >
        <Icon name="phone" size={20} className="shrink-0 text-forest" />
        <span className="flex-1">{prompt ?? t('turnOn')}</span>
        <span className="shrink-0 text-sprout-deep">{t('turnOnShort')} ›</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-soil">{t('intro')}</p>
      {state === 'unsupported' || state === 'blocked' || state === 'notConfigured' ? (
        <p className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">{t(state)}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${state === 'on' ? 'text-sprout-deep' : 'text-soil'}`}>
              {state === 'on' ? <Icon name="check" size={16} /> : null}
              {t(state)}
            </span>
            <div className="flex gap-2">
              {state === 'on' ? (
                <>
                  <button type="button" className="btn-secondary w-auto px-4" onClick={test} disabled={pending}>
                    {t('test')}
                  </button>
                  <button type="button" className="btn-secondary w-auto px-4" onClick={turnOff} disabled={pending}>
                    {t('turnOff')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn-primary w-auto px-5" onClick={turnOn} disabled={pending}>
                  {t('turnOn')}
                </button>
              )}
            </div>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold">{t('topics')}</legend>
            {(['orders', 'messages', 'vets', 'payouts'] as const).map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[#067647]"
                  checked={topics[k]}
                  onChange={() => toggleTopic(k)}
                  disabled={pending}
                />
                {t(`topic_${k}`)}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {message ? (
        <p role="status" className="text-sm font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

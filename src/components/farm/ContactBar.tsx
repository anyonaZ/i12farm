'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { getAnonymousId, track } from '@/lib/analytics/track';
import { displayPhone, toInternational } from '@/lib/phone';

type Channel = 'call' | 'whatsapp' | 'directions' | 'share';

interface Props {
  farmId: string;
  farmName: string;
  farmerName: string | null;
  phone: string | null;
  whatsapp: string | null;
  listingId: string | null;
  lng: number | null;
  lat: number | null;
  /** bar: fixed above the phone tab bar (hidden on desktop). panel: inside the desktop side panel.
   *  share: only the round Share button, for the photo header on phones. */
  variant?: 'bar' | 'panel' | 'share';
  /** bar only: when the farm shares no phone, the bar offers in-app messaging instead. */
  message?: () => Promise<void>;
  messageLabel?: string;
}

// Every tap is written to contact_events before the phone app opens. That
// row is Phase 1's proof that a buyer wanted this farm.
export function ContactBar({
  farmId,
  farmName,
  farmerName,
  phone,
  whatsapp,
  listingId,
  lng,
  lat,
  variant = 'bar',
  message,
  messageLabel,
}: Props) {
  const t = useTranslations('farm');
  const [copied, setCopied] = useState(false);

  function log(channel: Channel) {
    track('contact.tapped', { farm: farmId, channel });
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ farm_id: farmId, listing_id: listingId, channel, anonymous_id: getAnonymousId() }),
      keepalive: true,
    }).catch(() => undefined);
  }

  const panel = variant === 'panel';
  const tel = toInternational(phone);
  const wa = toInternational(whatsapp ?? phone);
  const greeting = encodeURIComponent(t('waGreeting', { farmer: farmerName ?? '', farm: farmName }));

  async function share() {
    log('share');
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: farmName, url }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (variant === 'share') {
    return (
      <button
        type="button"
        onClick={share}
        className="grid size-11 place-items-center rounded-full bg-white/85 text-forest lg:hidden"
        aria-label={copied ? t('linkCopied') : t('share')}
      >
        <Icon name={copied ? 'check' : 'share'} />
      </button>
    );
  }

  // A farm with no phone: show one clear way to reach it, not an empty bar.
  if (!panel && !tel && !wa) {
    if (!message && (lng === null || lat === null)) return null;
    return (
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <div className="mx-auto flex max-w-md gap-2">
          {message ? (
            <form action={message} className="min-w-0 flex-1">
              <button type="submit" className="btn-primary">
                <Icon name="chat" size={18} />
                {messageLabel}
              </button>
            </form>
          ) : null}
          {lng !== null && lat !== null ? (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
              target="_blank"
              rel="noopener"
              onClick={() => log('directions')}
              className={message ? 'grid size-12 shrink-0 place-items-center rounded-full border border-line' : 'btn-secondary'}
              aria-label={t('directions')}
            >
              <Icon name="route" />
              {message ? null : t('directions')}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        panel
          ? 'flex flex-col gap-2.5'
          : 'fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-3 lg:hidden'
      }
    >
      <div className={panel ? 'grid grid-cols-2 gap-2.5' : 'mx-auto grid max-w-md grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2'}>
        {tel ? (
          <a
            href={`tel:+${tel}`}
            onClick={() => log('call')}
            className={`btn-primary ${panel ? 'col-span-2' : 'min-w-0 gap-1.5 px-2.5 text-[15px]'}`}
            aria-label={`${t('call')} ${displayPhone(phone)}`}
          >
            <Icon name="phone" size={18} />
            {panel ? `${t('call')} · ${displayPhone(phone)}` : t('call')}
          </a>
        ) : (
          <span />
        )}
        {wa ? (
          <a
            href={`https://wa.me/${wa}?text=${greeting}`}
            target="_blank"
            rel="noopener"
            onClick={() => log('whatsapp')}
            className={`btn-secondary ${panel ? 'col-span-2' : 'min-w-0 gap-1.5 px-2.5 text-[15px]'}`}
          >
            <Icon name="chat" size={18} className="shrink-0" />
            <span className="truncate">{t('whatsapp')}</span>
          </a>
        ) : (
          <span />
        )}
        {lng !== null && lat !== null ? (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
            target="_blank"
            rel="noopener"
            onClick={() => log('directions')}
            className={panel ? 'btn-secondary min-h-11 text-sm' : 'grid size-12 place-items-center rounded-full border border-line'}
            aria-label={t('directions')}
          >
            <Icon name="route" />
            {panel ? t('directions') : null}
          </a>
        ) : null}
        {panel ? (
          <button
            type="button"
            onClick={share}
            className="btn-secondary min-h-11 text-sm"
            aria-label={copied ? t('linkCopied') : t('share')}
          >
            <Icon name={copied ? 'check' : 'share'} />
            {copied ? t('linkCopied') : t('share')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

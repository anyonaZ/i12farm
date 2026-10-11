'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { createClient } from '@/lib/supabase/client';
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
}

// Every tap is written to contact_events before the phone app opens. That
// row is Phase 1's proof that a buyer wanted this farm.
export function ContactBar({ farmId, farmName, farmerName, phone, whatsapp, listingId, lng, lat }: Props) {
  const t = useTranslations('farm');
  const [copied, setCopied] = useState(false);

  function log(channel: Channel) {
    track('contact.tapped', { farm: farmId, channel });
    createClient()
      .from('contact_events')
      .insert({ farm_id: farmId, listing_id: listingId, channel, anonymous_id: getAnonymousId() })
      .then(() => undefined);
  }

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

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-3">
      <div className="mx-auto grid max-w-md grid-cols-[1fr_1fr_auto_auto] gap-2.5">
        {tel ? (
          <a href={`tel:+${tel}`} onClick={() => log('call')} className="btn-primary" aria-label={`${t('call')} ${displayPhone(phone)}`}>
            <Icon name="phone" size={18} />
            {t('call')}
          </a>
        ) : (
          <span />
        )}
        {wa ? (
          <a href={`https://wa.me/${wa}?text=${greeting}`} target="_blank" rel="noopener" onClick={() => log('whatsapp')} className="btn-secondary">
            <Icon name="chat" size={18} />
            {t('whatsapp')}
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
            className="grid size-12 place-items-center rounded-full border border-line"
            aria-label={t('directions')}
          >
            <Icon name="route" />
          </a>
        ) : null}
        <button type="button" onClick={share} className="grid size-12 place-items-center rounded-full border border-line" aria-label={copied ? t('linkCopied') : t('share')}>
          <Icon name={copied ? 'check' : 'share'} />
        </button>
      </div>
    </div>
  );
}

'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { setLocale } from '@/app/actions/locale';
import { track } from '@/lib/analytics/track';

/** inNav: the copy in the desktop top bar; page-level copies hide on desktop. */
export function LanguageSwitch({ inNav = false }: { inNav?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('language');
  const [pending, startTransition] = useTransition();
  const next = locale === 'sw' ? 'en' : 'sw';

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          track('locale.changed', { from: locale, to: next });
          await setLocale(next);
        })
      }
      className={`chip min-h-tap ${inNav ? 'min-h-10' : 'lg:hidden'}`}
      aria-label={`${t('label')}: ${t(next)}`}
    >
      <span aria-hidden="true">{next === 'sw' ? 'SW' : 'EN'}</span>
      <span>{t(next)}</span>
    </button>
  );
}

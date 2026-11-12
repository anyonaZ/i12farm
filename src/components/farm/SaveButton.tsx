'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { toggleSavedFarm } from '@/domains/farms/actions';

export function SaveButton({ farmId, initial, signedIn }: { farmId: string; initial: boolean; signedIn: boolean }) {
  const t = useTranslations('farm');
  const router = useRouter();
  const [saved, setSaved] = useOptimistic(initial);
  const [, start] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={signedIn ? t('save') : t('signInToSave')}
      onClick={() => {
        if (!signedIn) {
          router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        start(async () => {
          setSaved(!saved);
          await toggleSavedFarm(farmId);
        });
      }}
      className="grid size-11 place-items-center rounded-full bg-surface/85 text-forest"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill={saved ? 'var(--color-amber)' : 'none'}
        stroke={saved ? 'var(--color-amber)' : 'currentColor'}
        strokeWidth="1.9"
        aria-hidden="true"
      >
        <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

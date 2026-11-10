'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { resolveReports } from '@/domains/farms/report-actions';

export function ResolveReportButtons({ farmId, hidden }: { farmId: string; hidden: boolean }) {
  const t = useTranslations('report');
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (a: 'dismissed' | 'suspended' | 'restored') =>
    start(async () => {
      await resolveReports(farmId, a);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary w-auto px-4" disabled={pending} onClick={() => act(hidden ? 'restored' : 'dismissed')}>
        {hidden ? t('restore') : t('dismiss')}
      </button>
      <button type="button" className="btn-primary w-auto px-4" disabled={pending} onClick={() => act('suspended')}>
        {t('suspend')}
      </button>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { acceptVetRequest, closeVetRequest } from '@/domains/vets/actions';
import { Icon } from '@/components/Icon';

export function TakeRequest({ requestId, farms }: { requestId: string; farms: { id: string; name: string }[] }) {
  const t = useTranslations('vets');
  const router = useRouter();
  const [farm, setFarm] = useState(farms[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!farms.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
      {farms.length > 1 ? (
        <select
          value={farm}
          onChange={(e) => setFarm(e.target.value)}
          className="input min-h-10 w-auto flex-1 text-sm"
          aria-label={t('inbox')}
        >
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptVetRequest(requestId, farm);
            if (res.ok) router.refresh();
            else setError(res.detail ?? res.error);
          })
        }
        className="btn-primary min-h-10 w-auto px-5 text-sm"
      >
        <Icon name="check" size={16} />
        {t('take')}
      </button>
      {error ? (
        <p role="alert" className="w-full text-sm font-semibold text-soil">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RequestActions({ requestId, canCancel, canComplete }: { requestId: string; canCancel: boolean; canComplete: boolean }) {
  const t = useTranslations('vets');
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (outcome: 'completed' | 'cancelled') =>
    start(async () => {
      await closeVetRequest(requestId, outcome);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      {canComplete ? (
        <button type="button" disabled={pending} onClick={() => act('completed')} className="btn-secondary min-h-10 w-auto px-4 text-sm">
          <Icon name="check" size={16} />
          {t('markDone')}
        </button>
      ) : null}
      {canCancel ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => act('cancelled')}
          className="min-h-10 rounded-full px-4 text-sm font-semibold text-soil underline"
        >
          {t('cancel')}
        </button>
      ) : null}
    </div>
  );
}

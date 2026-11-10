'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { reportFarm } from '@/domains/farms/report-actions';

const REASONS = ['fake', 'scam', 'wrong_info', 'offensive', 'other'] as const;

/** "Report this farm": a small form under the farm details. */
export function ReportFarm({ farmId, signedIn, back }: { farmId: string; signedIn: boolean; back: string }) {
  const t = useTranslations('report');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('fake');
  const [note, setNote] = useState('');
  const [done, setDone] = useState('');
  const [pending, start] = useTransition();

  if (done) return <p className="text-sm font-semibold text-sprout-deep">{done}</p>;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-soil underline">
        {t('title')}
      </button>
    );
  if (!signedIn)
    return (
      <Link href={`/sign-in?next=${encodeURIComponent(back)}`} className="self-start text-sm font-bold text-sprout-deep underline">
        {t('signIn')}
      </Link>
    );
  return (
    <form
      className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await reportFarm(farmId, reason, note);
          if (!r.ok) setDone(r.error);
          else setDone(r.data.outcome === 'already' ? t('already') : t('sent'));
        });
      }}
    >
      <h3 className="font-bold">{t('title')}</h3>
      <p className="text-sm text-soil">{t('intro')}</p>
      <fieldset className="flex flex-col gap-1">
        {REASONS.map((r) => (
          <label key={r} className="flex min-h-10 items-center gap-2.5 text-sm">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-[#067647]" />
            {t(`reason_${r}`)}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t('note')}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="input min-h-16 py-2" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary w-auto px-5">
          {t('send')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary w-auto px-5">
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

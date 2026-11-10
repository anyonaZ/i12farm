'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import {
  approveBatchAction,
  cancelBatchAction,
  checkBatchAction,
  prepareBatchAction,
  removeLineAction,
} from '@/domains/admin/payout-actions';
import { kes } from '@/lib/format';

export interface CandidateRow {
  key: string;
  kind: 'payout' | 'refund';
  id: string;
  label: string;
  sub: string;
  due: number;
  ready: boolean;
}

/** Pick what goes into the next batch. Lines without payout details can't be picked. */
export function PrepareBatch({ rows }: { rows: CandidateRow[] }) {
  const t = useTranslations('payouts');
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.filter((r) => r.ready).map((r) => r.key)));
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const chosen = rows.filter((r) => picked.has(r.key));
  const total = chosen.reduce((s, r) => s + r.due, 0);

  function toggle(key: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function prepare() {
    start(async () => {
      setMessage('');
      const r = await prepareBatchAction(
        chosen.map((c) => ({ kind: c.kind, id: c.id })),
        note,
      );
      if (!r.ok) return setMessage(r.error);
      const skipped = r.data.skipped.map((s) => `${s.name} (${s.reason})`).join('; ');
      if (r.data.batchId) router.push(`/admin/payouts/${r.data.batchId}${skipped ? `?skipped=${encodeURIComponent(skipped)}` : ''}`);
      else setMessage(t('skipped', { list: skipped }));
    });
  }

  if (!rows.length) return <p className="text-sm text-soil">{t('noneDue')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className="border-t border-line first:border-t-0">
            <label className={`flex min-h-14 items-center gap-3 py-2 ${r.ready ? 'cursor-pointer' : 'opacity-60'}`}>
              <input
                type="checkbox"
                className="size-5 accent-[#067647]"
                checked={picked.has(r.key)}
                disabled={!r.ready || pending}
                onChange={() => toggle(r.key)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.kind === 'refund' ? 'bg-amber/20' : 'bg-mint'}`}>
                    {t(r.kind)}
                  </span>
                  <b className="truncate">{r.label}</b>
                </span>
                <span className={`block truncate text-xs ${r.ready ? 'text-soil' : 'font-semibold text-forest'}`}>{r.sub}</span>
              </span>
              <b className="shrink-0 tabular-nums">{kes(r.due)}</b>
            </label>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {t('note')}
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="h-11 rounded-xl border border-line px-3" />
      </label>
      <button type="button" className="btn-primary" disabled={pending || !chosen.length} onClick={prepare}>
        {pending ? t('preparing') : t('prepare', { n: chosen.length, total: kes(total) })}
      </button>
      {message ? (
        <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function BatchActions({
  batchId,
  status,
  total,
  lines,
  inFlight,
}: {
  batchId: string;
  status: string;
  total: number;
  lines: number;
  inFlight: number;
}) {
  const t = useTranslations('payouts');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  // While lines are on their way, look again every 5 s (Pesi's callbacks land on the server).
  useEffect(() => {
    if (status !== 'sending' || inFlight === 0) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [status, inFlight, router]);

  const approve = () => {
    if (!window.confirm(t('approveConfirm', { total: kes(total), n: lines }))) return;
    start(async () => {
      const r = await approveBatchAction(batchId);
      if (!r.ok) setMessage(r.error);
      else
        setMessage(
          [
            t('sentResult', { sent: r.data.sent }),
            r.data.refused.length ? t('refused', { list: r.data.refused.map((x) => `${x.name}: ${x.reason}`).join('; ') }) : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      router.refresh();
    });
  };
  const cancel = () =>
    start(async () => {
      const r = await cancelBatchAction(batchId);
      if (!r.ok) setMessage(r.error);
      router.refresh();
    });
  const check = () =>
    start(async () => {
      const r = await checkBatchAction(batchId);
      setMessage(r.ok ? t('checked', r.data) : r.error);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'draft' ? (
          <>
            <button type="button" className="btn-primary w-auto px-5" disabled={pending || lines === 0} onClick={approve}>
              {t('approve', { total: kes(total) })}
            </button>
            <button type="button" className="btn-secondary w-auto px-5" disabled={pending} onClick={cancel}>
              {t('cancel')}
            </button>
          </>
        ) : null}
        {status === 'sending' && inFlight > 0 ? (
          <button type="button" className="btn-secondary w-auto px-5" disabled={pending} onClick={check}>
            {t('check')}
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="rounded-xl bg-mint px-3 py-2.5 text-sm font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function RemoveLine({ lineId }: { lineId: string }) {
  const t = useTranslations('payouts');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs font-bold text-soil underline"
      onClick={() =>
        start(async () => {
          await removeLineAction(lineId);
          router.refresh();
        })
      }
    >
      {t('remove')}
    </button>
  );
}

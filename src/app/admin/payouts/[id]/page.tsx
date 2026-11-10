import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { getBatch } from '@/domains/admin/disbursements';
import { requireRole } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import { BATCH_STYLE } from '../styles';
import { BatchActions, RemoveLine } from '../PayoutControls';

export const metadata = { title: 'Payout batch', robots: { index: false } };

const LINE_STYLE: Record<string, string> = {
  queued: 'bg-mint',
  requested: 'bg-mint',
  processing: 'bg-mint text-sprout-deep',
  completed: 'bg-sprout/15 text-sprout-deep',
  failed: 'bg-amber/20',
  cancelled: 'bg-line text-soil',
};

function where(r: Record<string, string | undefined>): string {
  switch (r.channel) {
    case 'M':
      return `M-Pesa ${r.mobile ?? ''}`;
    case 'B':
      return `${r.bankName ?? ''} ${r.account ?? ''}`;
    case 'PAYBILL':
      return `Paybill ${r.paybill ?? ''} · ${r.account ?? ''}`;
    case 'TILL':
      return `Till ${r.till ?? ''}`;
    default:
      return '';
  }
}

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skipped?: string }>;
}) {
  const { id } = await params;
  const { skipped } = await searchParams;
  const viewer = await requireRole('admin', `/admin/payouts/${id}`);
  const data = await getBatch(viewer, id);
  if (!data) notFound();
  const { batch: b, lines } = data;
  const t = await getTranslations('payouts');
  const format = await getFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const live = lines.filter((l) => l.status !== 'cancelled');
  const done = live.filter((l) => l.status === 'completed').length;

  return (
    <main className="mx-auto flex w-full flex-col gap-4 px-4 pb-24 pt-6 lg:max-w-4xl lg:px-8 lg:pb-16 lg:pt-10">
      <Link href="/admin/payouts" className="inline-flex min-h-11 items-center gap-2 self-start font-bold text-sprout-deep">
        <Icon name="back" size={18} />
        {t('back')}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-extrabold tracking-tight">{t('batch', { number: b.number })}</h1>
          <p className="text-sm text-soil">
            {t('createdBy', { name: b.created_by_name ?? '—', date: when(b.created_at) })}
            {b.approved_at ? ` · ${t('approvedBy', { name: b.approved_by_name ?? '—', date: when(b.approved_at) })}` : ''}
          </p>
          {b.note ? <p className="text-sm">{b.note}</p> : null}
        </div>
        <span className={`rounded-full px-3 py-1.5 text-sm font-bold ${BATCH_STYLE[b.status]}`}>{t(`bstatus_${b.status}`)}</span>
      </header>

      {skipped ? (
        <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
          {t('skipped', { list: skipped })}
        </p>
      ) : null}

      <section className="card gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="text-xl tabular-nums">{t('summary', { lines: b.lines, total: kes(b.total_kes) })}</b>
          {b.status !== 'draft' && b.status !== 'cancelled' ? (
            <span className="text-sm text-soil">{t('progress', { done, total: live.length, failed: b.failed, flying: b.in_flight })}</span>
          ) : null}
        </div>
        <BatchActions batchId={b.id} status={b.status} total={b.total_kes} lines={b.lines} inFlight={b.in_flight} />
      </section>

      <section className="card gap-0 p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-soil">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-semibold">{t('to')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('nameCheck')}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t('amount')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const r = l.receiver as unknown as Record<string, string | undefined>;
                const differs = l.kind === 'payout' && l.saved_name && l.validated_name && l.saved_name !== l.validated_name;
                return (
                  <tr
                    key={l.id}
                    className={`border-b border-line last:border-b-0 align-top ${l.status === 'cancelled' ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${l.kind === 'refund' ? 'bg-amber/20' : 'bg-mint'}`}
                      >
                        {t(l.kind)}
                      </span>
                      <b>{l.kind === 'refund' ? `#${l.order_number}` : l.farm_name}</b>
                      <span className="block text-xs text-soil">{where(r)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {l.validated_name ?? '—'}
                      {differs ? (
                        <span className="block text-xs font-semibold text-forest">⚠ {t('nameDiffers', { saved: l.saved_name! })}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">{kes(l.amount_kes)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${LINE_STYLE[l.status]}`}>
                        {t(`status_${l.status}`)}
                      </span>
                      {l.status_description && l.status !== 'completed' ? (
                        <span className="mt-1 block text-xs text-soil">{l.status_description}</span>
                      ) : null}
                      {l.trace_id && l.status === 'completed' ? (
                        <span className="mt-1 block text-[11px] text-soil">{l.trace_id}</span>
                      ) : null}
                      {b.status === 'draft' && l.status === 'queued' ? (
                        <span className="mt-1 block">
                          <RemoveLine lineId={l.id} />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

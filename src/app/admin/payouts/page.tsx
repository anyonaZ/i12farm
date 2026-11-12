import { titled } from '@/lib/titles';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { listBatches, payoutCandidates, pesiBalance } from '@/domains/admin/disbursements';
import { requireRole } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import { pesiMode } from '@/lib/pesi';
import { payoutWhere } from '@/app/my-farm/payout-where';
import { PrepareBatch, type CandidateRow } from './PayoutControls';
import { BATCH_STYLE } from './styles';

export const generateMetadata = titled('payouts', { robots: { index: false } });

// Admin: money out through Pesi, in batches you approve.
export default async function PayoutsPage() {
  const viewer = await requireRole('admin', '/admin/payouts');
  const t = await getTranslations();
  const format = await getFormatter();
  const [candidates, batches, balance] = await Promise.all([payoutCandidates(viewer), listBatches(viewer), pesiBalance()]);
  const label = (k: 'channelM' | 'channelB' | 'channelPAYBILL' | 'channelTILL') => t(`payouts.${k}`);

  const rows: CandidateRow[] = candidates.map((c) => ({
    key: `${c.kind}:${c.kind === 'payout' ? c.farm_id : c.order_id}`,
    kind: c.kind,
    id: (c.kind === 'payout' ? c.farm_id : c.order_id)!,
    label: c.kind === 'refund' ? `#${c.order_number} · ${c.name}` : c.name,
    sub: c.channel
      ? [payoutWhere({ ...c, channel: c.channel }, label), c.registered_name ? t('payouts.lastChecked', { name: c.registered_name }) : '']
          .filter(Boolean)
          .join(' · ')
      : t('payouts.noDetails'),
    due: c.due_kes,
    ready: Boolean(c.channel),
  }));

  return (
    <main className="mx-auto flex w-full flex-col gap-4 px-4 pb-24 pt-6 lg:max-w-4xl lg:px-8 lg:pb-16 lg:pt-10">
      <Link href="/admin?tab=money" className="inline-flex min-h-11 items-center gap-2 self-start font-bold text-sprout-deep">
        <Icon name="back" size={18} />
        {t('admin.money')}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('payouts.adminTitle')}</h1>
        <p className="max-w-[62ch] text-soil">{t('payouts.adminIntro')}</p>
      </header>

      <section className="card gap-2">
        <p className={`rounded-xl px-3 py-2 text-sm font-semibold ${pesiMode === 'production' ? 'bg-amber/20' : 'bg-mint'}`}>
          {t(`payouts.mode_${pesiMode}`)}
        </p>
        {balance.accounts.map((a) => (
          <div key={a.number} className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-soil">
              {t('payouts.balance')} · {a.name} ({a.number})
            </span>
            <b className="text-xl tabular-nums">{kes(a.balance)}</b>
          </div>
        ))}
        {balance.error ? <p className="text-sm text-soil">{t('payouts.balanceError', { reason: balance.error })}</p> : null}
      </section>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('payouts.due')}</h2>
        <PrepareBatch rows={rows} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">{t('payouts.batches')}</h2>
        {batches.length ? (
          <ul className="flex flex-col gap-2">
            {batches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/payouts/${b.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 hover:border-sprout"
                >
                  <span className="min-w-0">
                    <b className="block">{t('payouts.batch', { number: b.number })}</b>
                    <span className="text-sm text-soil">
                      {format.dateTime(new Date(b.created_at), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} ·{' '}
                      {t('payouts.summary', { lines: b.lines, total: kes(b.total_kes) })}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${BATCH_STYLE[b.status]}`}>
                    {t(`payouts.bstatus_${b.status}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-soil">{t('payouts.noBatches')}</p>
        )}
      </section>
    </main>
  );
}

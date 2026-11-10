import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { farmPayouts, getPayoutAccount, listBanks } from '@/domains/admin/disbursements';
import { listManagedFarms } from '@/domains/farms/queries';
import { requireViewer } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import { payoutWhere } from '../../payout-where';
import { PayoutAccountForm } from './PayoutAccountForm';

export const metadata = { title: 'Payout details', robots: { index: false } };

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-sprout/15 text-sprout-deep',
  failed: 'bg-amber/20',
  queued: 'bg-mint',
  requested: 'bg-mint',
  processing: 'bg-mint',
};

export default async function FarmPayoutsPage({ params }: { params: Promise<{ farmId: string }> }) {
  const { farmId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(farmId)) notFound();
  const viewer = await requireViewer(`/my-farm/${farmId}/payouts`);
  const [farm] = await listManagedFarms(viewer.id, farmId);
  if (!farm) notFound();
  const t = await getTranslations();
  const format = await getFormatter();
  const [account, banks, history] = await Promise.all([getPayoutAccount(viewer, farmId), listBanks(), farmPayouts(viewer, farmId)]);
  const when = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <main className="mx-auto flex w-full flex-col gap-4 px-4 pb-24 pt-6 lg:max-w-2xl lg:px-8 lg:pb-16 lg:pt-10">
      <Link href={`/my-farm/${farmId}`} className="inline-flex min-h-11 items-center gap-2 self-start font-bold text-sprout-deep">
        <Icon name="back" size={18} />
        {farm.name}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('payouts.farmTitle')}</h1>
        <p className="text-soil">{t('payouts.farmIntro')}</p>
      </header>

      <section className="card gap-2">
        {account ? (
          <>
            <p className="font-bold">{t('payouts.current', { where: payoutWhere(account, (k) => t(`payouts.${k}` as never)) })}</p>
            {account.registered_name ? (
              <p className="flex items-center gap-1.5 text-sm text-sprout-deep">
                <Icon name="check" size={16} />
                {t('payouts.belongsTo', { name: account.registered_name })}
                {account.checked_at ? (
                  <span className="text-soil">· {t('payouts.checkedOn', { date: when(account.checked_at) })}</span>
                ) : null}
              </p>
            ) : null}
          </>
        ) : (
          <p className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">{t('payouts.notSet')}</p>
        )}
      </section>

      <section className="card gap-3">
        <PayoutAccountForm
          farmId={farmId}
          current={account}
          banks={banks}
          defaultMobile={(viewer.contactPhone ?? (viewer.phone ? '+' + viewer.phone : '')).replace(/^\+254/, '0')}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">{t('payouts.history')}</h2>
        {history.length ? (
          <ul className="flex flex-col gap-2">
            {history.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5">
                <span className="text-sm text-soil">{when(p.completed_at ?? p.requested_at)}</span>
                <span className="flex items-center gap-2">
                  <span className="text-right">
                    <b className="block tabular-nums">{kes(p.amount_kes - p.fee_kes)}</b>
                    {p.fee_kes > 0 ? (
                      <span className="block text-xs text-soil">
                        {t('payouts.fee')} {kes(p.fee_kes)}
                      </span>
                    ) : null}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[p.status] ?? 'bg-line'}`}>
                    {t(`payouts.status_${p.status}` as never)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-soil">{t('payouts.noHistory')}</p>
        )}
      </section>
    </main>
  );
}

import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { adminListFarms, adminListUsers, adminMoney } from '@/domains/admin/queries';
import { requireRole } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { getInsights } from '@/domains/admin/insights';
import { withUser } from '@/lib/db';
import {
  CommissionForm,
  FarmVerifyButton,
  PayoutForm,
  PayoutImport,
  RefundForm,
  TradeSettingsForm,
  UpkeepButton,
  UserRow,
} from './AdminControls';
import { InsightsView } from './Insights';
import { VetRequestsView } from './VetRequests';

export const metadata = { title: 'Admin', robots: { index: false } };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; all?: string; days?: string }>;
}) {
  const viewer = await requireRole('admin', '/admin');
  const { q = '', tab = 'people', all, days: daysParam } = await searchParams;
  const days = daysParam === '90' ? 90 : daysParam === '7' ? 7 : 30;
  const t = await getTranslations('admin');
  const format = await getFormatter();
  const money = tab === 'money' ? await adminMoney(viewer) : null;
  const insights = tab === 'insights' ? await getInsights(viewer, days) : null;
  const settings =
    tab === 'settings'
      ? Object.fromEntries(
          (await withUser(viewer.id, (tx) => tx<{ key: string; value: unknown }[]>`select key, value from public.platform_settings`)).map(
            (r) => [r.key, r.value],
          ),
        )
      : null;
  const tabs = [
    { key: 'insights', label: t('insights'), icon: 'chart' as const },
    { key: 'people', label: t('users'), icon: 'user' as const },
    { key: 'farms', label: t('farms'), icon: 'badge' as const },
    { key: 'money', label: t('money'), icon: 'wallet' as const },
    { key: 'vets', label: t('vetsTab'), icon: 'cross' as const },
    { key: 'settings', label: t('settings'), icon: 'clipboard' as const },
  ];

  return (
    <main className="mx-auto w-full flex flex-col gap-4 px-4 pb-24 pt-6 lg:max-w-5xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-center gap-3">
        <Link href="/my-farm" className="grid size-11 place-items-center rounded-full border border-line bg-surface" aria-label={t('back')}>
          <Icon name="back" />
        </Link>
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
      </header>
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" aria-label={t('title')}>
        {tabs.map((x) => (
          <Link
            key={x.key}
            href={`/admin?tab=${x.key}`}
            aria-current={tab === x.key ? 'page' : undefined}
            className={`flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-bold ${tab === x.key ? 'border-forest bg-forest text-white' : 'border-line bg-surface text-soil'}`}
          >
            <Icon name={x.icon} size={16} />
            {x.label}
          </Link>
        ))}
      </nav>

      {tab === 'vets' ? <VetRequestsView viewer={viewer} /> : null}

      {tab === 'people' ? (
        <>
          <form className="flex gap-2" action="/admin">
            <input type="hidden" name="tab" value="people" />
            <label htmlFor="admin-q" className="sr-only">
              {t('search')}
            </label>
            <input id="admin-q" name="q" defaultValue={q} placeholder={t('search')} className="input" />
            <button type="submit" className="btn-secondary w-auto px-4">
              {t('searchButton')}
            </button>
          </form>
          <ul className="flex flex-col gap-2.5">
            {(await adminListUsers(viewer, q)).map((u) => (
              <UserRow
                key={u.id}
                user={{
                  ...u,
                  phoneDisplay: u.phone ? displayPhone('+' + u.phone) : null,
                  joined: format.relativeTime(new Date(u.created_at)),
                  lastSeen: u.last_sign_in_at ? format.relativeTime(new Date(u.last_sign_in_at)) : null,
                }}
                isSelf={u.id === viewer.id}
              />
            ))}
          </ul>
        </>
      ) : null}

      {tab === 'farms' ? (
        <>
          <Link
            href={all ? '/admin?tab=farms' : '/admin?tab=farms&all=1'}
            className="inline-flex min-h-11 items-center self-start text-sm font-bold text-sprout-deep"
          >
            {all ? t('farms') : t('allFarms')}
          </Link>
          <ul className="flex flex-col gap-2">
            {(await adminListFarms(viewer, !all)).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
                <span className="min-w-0">
                  <Link href={`/f/${f.slug}`} className="flex min-h-11 items-center truncate font-bold underline-offset-2 hover:underline">
                    {f.name}
                  </Link>
                  <span className="block truncate text-sm text-soil">
                    {[f.farmer_name, f.place_name, f.county_name].filter(Boolean).join(' · ')}
                  </span>
                  <span className="block truncate text-xs text-soil">
                    {f.managed_by_name ? t('enrolledBy', { name: f.managed_by_name }) : ''}
                    {f.owner_claimed ? ` · ${t('claimed')}` : ''}
                  </span>
                </span>
                <FarmVerifyButton farmId={f.id} verified={f.verified} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {money ? (
        <>
          <dl className="grid grid-cols-3 gap-2">
            {[
              [t('paidOrders'), String(money.totals.paid_orders)],
              [t('gmv'), kes(money.totals.gmv)],
              [t('commissionEarned'), kes(money.totals.commission)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse rounded-2xl bg-surface p-3">
                <dt className="text-xs text-soil">{label}</dt>
                <dd className="text-lg font-extrabold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <section className="card gap-3">
            <h2 className="text-lg font-bold">{t('payouts')}</h2>
            {money.payouts.length === 0 ? <p className="text-sm text-soil">{t('noPayouts')}</p> : null}
            {money.payouts.map((p) => (
              <div key={p.farm_id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <b className="block truncate">{p.farm_name}</b>
                    <span className="text-sm text-soil">M-Pesa {p.payout_phone ? displayPhone(p.payout_phone) : '—'}</span>
                  </span>
                  <b className="tabular-nums">{kes(p.due_kes)}</b>
                </div>
                <PayoutForm farmId={p.farm_id} due={p.due_kes} />
              </div>
            ))}
          </section>
          <section className="card gap-3">
            <h2 className="text-lg font-bold">{t('refunds')}</h2>
            {money.refunds.length === 0 ? <p className="text-sm text-soil">{t('noRefunds')}</p> : null}
            {money.refunds.map((r) => (
              <div key={r.order_id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <Link href={`/orders/${r.number}`} className="block truncate font-bold">
                      #{r.number} · {r.farm_name}
                    </Link>
                    <span className="text-sm text-soil">M-Pesa {displayPhone('+' + r.buyer_phone)}</span>
                  </span>
                  <b className="tabular-nums">{kes(r.due_kes)}</b>
                </div>
                <RefundForm orderId={r.order_id} />
              </div>
            ))}
          </section>
          <section className="card gap-3">
            <h2 className="text-lg font-bold">{t('csvTitle')}</h2>
            <p className="text-sm text-soil">{t('csvHint')}</p>
            <a href="/admin/export/payouts.csv" className="btn-secondary">
              {t('downloadCsv')}
            </a>
            <PayoutImport />
          </section>
        </>
      ) : null}
      {insights ? <InsightsView data={insights} /> : null}

      {settings ? (
        <>
          <section className="card gap-3">
            <CommissionForm percent={Number(settings.commission_bps ?? 1000) / 100} />
          </section>
          <section className="card gap-3">
            <TradeSettingsForm
              autoCompleteDays={Number(settings.auto_complete_days ?? 3)}
              unpaidHours={Number(settings.unpaid_cancel_hours ?? 48)}
              declineHours={Number(settings.paid_decline_hours ?? 36)}
              plans={((settings.premium_plans as { days: number; price: number }[] | undefined) ?? [])
                .map((p) => `${p.days}, ${p.price}`)
                .join('\n')}
            />
          </section>
          <section className="card gap-3">
            <UpkeepButton />
          </section>
        </>
      ) : null}
    </main>
  );
}

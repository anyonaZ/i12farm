import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { adminReach } from '@/domains/admin/queries';
import { allBroadcasts } from '@/domains/broadcasts/queries';
import { listCounties, listFarmCategories } from '@/domains/reference/queries';
import type { Viewer } from '@/lib/auth/viewer';
import { smsMode } from '@/lib/sms';
import { displayPhone } from '@/lib/phone';
import type { Locale } from '@/i18n/config';
import { BroadcastReview, ReachSettingsForm, SendNowButton, UssdSimulator } from './ReachControls';

const STATUS: Record<string, string> = {
  queued: 'bg-amber/20',
  sending: 'bg-amber/20',
  sent: 'bg-sprout/15 text-sprout-deep',
  delivered: 'bg-sprout/15 text-sprout-deep',
  simulated: 'bg-mint',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-line text-soil',
};

export async function ReachView({ viewer }: { viewer: Viewer }) {
  const t = await getTranslations('admin');
  const tp = await getTranslations('partner');
  const tv = await getTranslations('vets');
  const format = await getFormatter();
  const locale = (await getLocale()) as Locale;
  const [reach, broadcasts, counties, categories] = await Promise.all([
    adminReach(viewer),
    allBroadcasts(viewer),
    listCounties(),
    listFarmCategories(locale),
  ]);
  const s = reach.settings;
  const num = (k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : Number(s[k] ?? d));
  const ussdCode = typeof s.ussd_code === 'string' ? s.ussd_code : '';
  const when = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const countyName = (code: number) => counties?.find((c) => c.code === code)?.name ?? String(code);
  const categoryName = (slug: string) => categories?.find((c) => c.slug === slug)?.name ?? slug;

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <section className="card gap-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{t('smsMode', { mode: smsMode })}</h2>
          <SendNowButton />
        </div>
        {smsMode === 'simulate' ? <p className="text-sm text-soil">{t('smsModeHint')}</p> : null}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [t('smsToday', { count: reach.today, cap: num('sms_daily_cap', 1000) }), ''],
            [t('smsQueued', { count: reach.queued }), ''],
            [t('failed7d', { n: reach.failed7d }), ''],
            [t('cost30d', { kes: reach.cost30d.toLocaleString('en-KE') }), ''],
          ].map(([label]) => (
            <div key={label} className="rounded-xl bg-mint px-3 py-2.5 text-sm font-bold tabular-nums">
              {label}
            </div>
          ))}
        </dl>
      </section>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('broadcasts')}</h2>
        {broadcasts.length ? (
          <ul className="flex flex-col gap-2">
            {broadcasts.slice(0, 10).map((b) => (
              <li key={b.id} className="flex flex-col gap-1.5 rounded-2xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">{b.organisation}</p>
                  <span className="shrink-0 rounded-full bg-mint px-2.5 py-1 text-xs font-bold">{tp(`status.${b.status}`)}</span>
                </div>
                <p className="text-sm">EN: {b.body_en}</p>
                <p className="text-sm">SW: {b.body_sw}</p>
                <p className="text-xs text-soil">
                  {b.counties.length ? b.counties.map(countyName).join(', ') : tp('allCounties')} ·{' '}
                  {b.categories.length ? b.categories.map(categoryName).join(', ') : tp('allCategories')} ·{' '}
                  {t('audienceOf', { count: b.recipients ?? b.estimated_recipients })} · {b.author} · {when(b.created_at)}
                </p>
                {b.stats ? (
                  <p className="text-xs font-semibold tabular-nums">
                    {tp('stats', {
                      sent: b.stats.sent + b.stats.delivered,
                      delivered: b.stats.delivered,
                      failed: b.stats.failed,
                      skipped: b.stats.skipped,
                    })}
                  </p>
                ) : null}
                {b.status === 'pending_review' ? <BroadcastReview id={b.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-soil">{t('noBroadcasts')}</p>
        )}
      </section>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('ussd')}</h2>
        <p className="text-sm text-soil">{t('ussdHint')}</p>
        <UssdSimulator code={ussdCode} />
      </section>

      <section className="card gap-3 lg:col-span-2">
        <h2 className="text-lg font-bold">{t('outbox')}</h2>
        {reach.outbox.length ? (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-soil">
                <tr>
                  <th className="py-2 pr-3">{t('colTime')}</th>
                  <th className="py-2 pr-3">{t('colPhone')}</th>
                  <th className="py-2 pr-3">{t('colMessage')}</th>
                  <th className="py-2">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {reach.outbox.map((m) => (
                  <tr key={m.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-soil">{when(m.created_at)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{displayPhone(m.phone)}</td>
                    <td className="py-2 pr-3">
                      <span className="text-xs font-semibold text-soil">
                        {m.template} · {m.locale}
                      </span>
                      <span className="block">{m.body ?? '…'}</span>
                      {m.error ? <span className="block text-xs text-red-800">{m.error}</span> : null}
                    </td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS[m.status] ?? ''}`}>{m.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-soil">{t('noSms')}</p>
        )}
      </section>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('vetRequests')}</h2>
        {reach.requests.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {reach.requests.map((r) => (
              <li key={r.number} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <b>{r.number}</b> · {categoryName(r.animal)} · {r.county} · {r.via.toUpperCase()}
                  <span className="block text-xs text-soil">
                    {when(r.created_at)} · {tv('alerted', { count: r.vets_alerted })}
                    {r.vet ? ` · ${r.vet}` : ''}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-mint px-2 py-0.5 text-xs font-bold">{tv(`status.${r.status}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-soil">{tv('none')}</p>
        )}
      </section>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('reachSettings')}</h2>
        <ReachSettingsForm
          smsDailyCap={num('sms_daily_cap', 1000)}
          smsCost={num('sms_cost_kes', 0.8)}
          ussdCode={ussdCode}
          vetAlertMax={num('vet_alert_max', 10)}
          vetHours={num('vet_request_hours', 48)}
        />
      </section>
    </div>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Insights } from '@/domains/admin/insights';
import { kes } from '@/lib/format';

// Admin dashboard. One hue (Sprout Deep) for every chart because each chart
// has a single series; labels stay in text colours. Bars carry a native
// <title> tooltip, and the tables below hold the same numbers.

const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));

export async function InsightsView({ data }: { data: Insights }) {
  const t = await getTranslations('admin');
  const k = data.kpi;
  const tiles: [string, string][] = [
    [t('kpi.gmv'), kes(k.gmv)],
    [t('kpi.commission'), kes(k.commission)],
    [t('promotionRevenue'), kes(k.promotions)],
    [t('kpi.paid'), String(k.paid)],
    [t('kpi.orders'), String(k.orders)],
    [t('kpi.contacts'), String(k.contacts)],
    [t('kpi.views'), String(k.views)],
    [t('kpi.people'), String(k.people)],
    [t('kpi.farms'), String(k.farms)],
  ];
  const funnel: [string, number][] = [
    [t('funnelSteps.views'), k.views],
    [t('funnelSteps.contacts'), k.contacts],
    [t('funnelSteps.placed'), k.orders],
    [t('funnelSteps.paid'), k.paid],
  ];

  return (
    <>
      <nav className="flex flex-wrap gap-1.5" aria-label={t('period', { days: data.days })}>
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            href={`/admin?tab=insights&days=${d}`}
            aria-current={d === data.days ? 'page' : undefined}
            className={`chip min-h-11 px-3 text-xs font-bold ${d === data.days ? 'border-forest bg-forest text-surface' : ''}`}
          >
            {t('period', { days: d })}
          </Link>
        ))}
      </nav>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col-reverse rounded-2xl border border-line bg-surface p-3">
            <dt className="text-xs leading-tight text-soil">{label}</dt>
            <dd className="text-lg font-extrabold leading-tight tabular-nums [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="card gap-2">
        <h2 className="text-base font-bold">{t('weekly')}</h2>
        <WeeklyBars weeks={data.weekly} emptyText={t('noData')} />
      </section>

      <section className="card gap-3">
        <h2 className="text-base font-bold">{t('funnel')}</h2>
        <Funnel steps={funnel} />
      </section>

      <section className="card gap-2 p-0">
        <h2 className="px-5 pt-4 text-base font-bold">{t('byCounty')}</h2>
        {/* Focusable so keyboard users can scroll the table sideways on a phone. */}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('byCounty')}>
          <table className="w-full min-w-[22rem] text-sm tabular-nums">
            <thead className="text-xs text-soil">
              <tr>
                <th className="px-5 py-2 text-left font-semibold">{t('county')}</th>
                <th className="px-2 py-2 text-right font-semibold">{t('kpi.farms')}</th>
                <th className="px-2 py-2 text-right font-semibold">{t('kpi.contacts')}</th>
                <th className="px-5 py-2 text-right font-semibold">{t('kpi.gmv')}</th>
              </tr>
            </thead>
            <tbody>
              {data.counties.map((c) => (
                <tr key={c.county} className="border-t border-line">
                  <td className="px-5 py-2 font-semibold">{c.county}</td>
                  <td className="px-2 py-2 text-right">{c.farms}</td>
                  <td className="px-2 py-2 text-right">{c.contacts}</td>
                  <td className="px-5 py-2 text-right">{short(c.gmv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card gap-2 p-0">
        <h2 className="px-5 pt-4 text-base font-bold">{t('topProducts')}</h2>
        {data.products.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-soil">{t('noData')}</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('topProducts')}>
            <table className="w-full min-w-[22rem] text-sm tabular-nums">
              <thead className="text-xs text-soil">
                <tr>
                  <th className="px-5 py-2 text-left font-semibold">{t('product')}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t('qty')}</th>
                  <th className="px-5 py-2 text-right font-semibold">{t('value')}</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.title} className="border-t border-line">
                    <td className="px-5 py-2 font-semibold">{p.title}</td>
                    <td className="px-2 py-2 text-right">{p.qty}</td>
                    <td className="px-5 py-2 text-right">{kes(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card gap-2">
        <h2 className="text-base font-bold">{t('export')}</h2>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['orders', t('exportOrders')],
              ['contacts', t('exportContacts')],
              ['daily', t('exportDaily')],
            ] as const
          ).map(([kind, label]) => (
            <a key={kind} href={`/admin/export/${kind}.csv`} className="btn-secondary min-h-11 px-2 text-xs">
              {label}
            </a>
          ))}
        </div>
      </section>
    </>
  );
}

function WeeklyBars({ weeks, emptyText }: { weeks: Insights['weekly']; emptyText: string }) {
  const W = 340;
  const H = 160;
  const top = 20;
  const bottom = 24;
  const left = 40;
  const max = Math.max(...weeks.map((w) => w.gmv), 0);
  if (max === 0) return <p className="text-sm text-soil">{emptyText}</p>;
  const nice = niceMax(max);
  const plotH = H - top - bottom;
  const step = (W - left) / weeks.length;
  const barW = Math.max(4, step - 2); // 2px gap between bars
  const y = (v: number) => top + plotH - (v / nice) * plotH;
  const label = (iso: string) =>
    new Date(`${iso}T12:00:00+03:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
  const peak = weeks.reduce((best, w, i) => (w.gmv > weeks[best].gmv ? i : best), 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-2xl"
      role="img"
      aria-label={weeks.map((w) => `${label(w.week)}: KES ${Math.round(w.gmv)}`).join('; ')}
    >
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={left} x2={W} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={left - 6} y={y(nice * f) + 3.5} textAnchor="end" fontSize={13} fill="var(--color-soil)">
            {short(nice * f)}
          </text>
        </g>
      ))}
      {weeks.map((w, i) => {
        const x = left + i * step + 1;
        const h = Math.max(0, y(0) - y(w.gmv));
        const r = Math.min(4, barW / 2, h);
        return (
          <g key={w.week}>
            <title>{`${label(w.week)}: KES ${Math.round(w.gmv).toLocaleString('en-KE')} · ${w.orders} orders`}</title>
            {/* wide invisible hit area for the tooltip */}
            <rect x={x - 1} y={top} width={step} height={plotH} fill="transparent" />
            {h > 0 ? (
              <path
                d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                fill="var(--color-sprout-deep)"
              />
            ) : null}
            {i === peak ? (
              <text x={x + barW / 2} y={y(w.gmv) - 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--color-forest)">
                {short(w.gmv)}
              </text>
            ) : null}
            {i % 3 === 0 || i === weeks.length - 1 ? (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={12.5} fill="var(--color-soil)">
                {label(w.week)}
              </text>
            ) : null}
          </g>
        );
      })}
      <line x1={left} x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-soil)" strokeWidth={1} />
    </svg>
  );
}

function Funnel({ steps }: { steps: [string, number][] }) {
  const max = Math.max(...steps.map(([, n]) => n), 1);
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map(([label, n], i) => {
        const prev = i > 0 ? steps[i - 1][1] : null;
        const rate = prev ? Math.round((n / prev) * 1000) / 10 : null;
        return (
          <li key={label} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2.5 text-sm">
            <span className="leading-tight text-soil">{label}</span>
            <span className="h-3 overflow-hidden rounded-full bg-mint" title={`${label}: ${n}`}>
              <i className="block h-full rounded-full bg-sprout-deep" style={{ width: `${n > 0 ? Math.max(2, (n / max) * 100) : 0}%` }} />
            </span>
            <span className="text-right tabular-nums">
              <b>{n.toLocaleString('en-KE')}</b>
              {rate !== null ? <span className="ml-1 text-xs text-soil">({rate}%)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function niceMax(v: number): number {
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

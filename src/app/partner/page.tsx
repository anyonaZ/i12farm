import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Icon, type IconName } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { countyInsight } from '@/domains/insights/queries';
import { listFarmCategories, listPilotCounties, listProducts } from '@/domains/reference/queries';
import { requireViewer } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export const metadata = { title: 'County insights', robots: { index: false } };

const PERIODS = [30, 90, 365] as const;

// County dashboard for partner organisations (county offices, cooperatives,
// NGOs) and admins. Everything is aggregated in the database; small groups are
// hidden there, not here.
export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ county?: string; days?: string }> }) {
  const viewer = await requireViewer('/partner');
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = (await getLocale()) as Locale;
  const allowed = viewer.roles.includes('partner') || viewer.roles.includes('admin');

  if (!allowed) {
    return (
      <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-24 pt-8 lg:max-w-3xl lg:px-8 lg:pt-10">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('partner.title')}</h1>
        <p className="card text-soil">{t('partner.notPartner')}</p>
      </main>
    );
  }

  const sp = await searchParams;
  const [counties, categories, products] = await Promise.all([listPilotCounties(), listFarmCategories(locale), listProducts(locale)]);
  const county = counties?.find((c) => String(c.code) === sp.county) ?? null;
  const days = PERIODS.find((d) => String(d) === sp.days) ?? 90;
  const data = await countyInsight(viewer, county?.code ?? null, days);

  const where = county?.name ?? t('partner.allPilot');
  const catName = (s: string) => categories?.find((c) => c.slug === s)?.name ?? s;
  const productName = (s: string) => products.find((p) => p.slug === s)?.name ?? s;
  const unitName = (u: string) => (t.has(`units.${u}`) ? t(`units.${u}` as never) : u);
  const href = (next: { county?: number | null; days?: number }) => {
    const q = new URLSearchParams();
    const c = next.county === undefined ? county?.code : next.county;
    if (c) q.set('county', String(c));
    const d = next.days ?? days;
    if (d !== 90) q.set('days', String(d));
    const s = q.toString();
    return s ? `/partner?${s}` : '/partner';
  };
  const maxType = Math.max(1, ...data.farms.by_type.map((x) => x.farms));

  return (
    <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-24 pt-8 lg:max-w-6xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-extrabold tracking-tight">{t('partner.title')}</h1>
          <p className="max-w-[62ch] text-soil">{t('partner.subtitle')}</p>
        </div>
        <div className="lg:hidden">
          <LanguageSwitch />
        </div>
      </header>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label={t('prices.countyLabel')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
          <Chip href={href({ county: null })} active={!county}>
            {t('partner.allPilot')}
          </Chip>
          {(counties ?? []).map((c) => (
            <Chip key={c.code} href={href({ county: c.code })} active={county?.code === c.code}>
              {c.name}
            </Chip>
          ))}
        </nav>
        <nav aria-label={t('partner.period')} className="flex gap-1 rounded-full border border-line bg-surface p-1">
          {PERIODS.map((d) => (
            <Link
              key={d}
              href={href({ days: d })}
              scroll={false}
              aria-current={d === days ? 'page' : undefined}
              className={`inline-flex h-8 items-center rounded-full px-3 text-sm font-semibold ${d === days ? 'bg-forest text-white' : 'text-soil hover:bg-mint'}`}
            >
              {t('partner.days', { n: d })}
            </Link>
          ))}
        </nav>
      </div>

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon="sprout" label={t('partner.farms')} value={format.number(data.farms.published)}>
          {t('partner.farmsSub', { verified: data.farms.verified, new: data.farms.new })}
        </Tile>
        <Tile icon="bag" label={t('partner.orders')} value={data.trade.hidden ? '–' : format.number(data.trade.orders)}>
          {data.trade.hidden
            ? t('partner.hiddenFew', { n: data.min_count })
            : t('partner.ordersSub', { value: kes(data.trade.value_kes), farms: data.trade.farms })}
        </Tile>
        <Tile icon="phone" label={t('partner.contacts')} value={format.number(data.contacts.total)}>
          {t('partner.contactsSub', { farms: data.contacts.farms })}
        </Tile>
        <Tile icon="cross" label={t('partner.vets')} value={data.vets.hidden ? '–' : format.number(data.vets.total)}>
          {data.vets.hidden ? t('partner.hiddenFew', { n: data.min_count }) : t('partner.vetsSub', { n: data.vets.answered })}
        </Tile>
      </ul>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section className="card gap-3 p-4" aria-labelledby="unmet">
          <div>
            <h2 id="unmet" className="text-lg font-bold">
              {t('partner.unmetTitle')}
            </h2>
            <p className="text-sm text-soil">{t('partner.unmetHint', { where })}</p>
          </div>
          {data.demand.unmet.length ? (
            <BarList
              rows={data.demand.unmet.map((d) => ({
                key: d.term,
                label: d.term,
                value: d.searchers,
                note: t('prices.buyersN', { n: d.searchers }),
              }))}
              tone="amber"
              capitalize
            />
          ) : (
            <p className="text-sm text-soil">{t('partner.none')}</p>
          )}
        </section>

        <section className="card gap-3 p-4" aria-labelledby="searched">
          <div>
            <h2 id="searched" className="text-lg font-bold">
              {t('partner.searchedTitle')}
            </h2>
            <p className="text-sm text-soil">{t('partner.searchedHint')}</p>
          </div>
          {data.demand.searched.length ? (
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-soil">
                <tr>
                  <th className="py-1 pr-2 font-semibold">{t('partner.term')}</th>
                  <th className="py-1 pr-2 text-right font-semibold">{t('partner.searchers')}</th>
                  <th className="py-1 text-right font-semibold">{t('partner.found')}</th>
                </tr>
              </thead>
              <tbody>
                {data.demand.searched.map((d) => (
                  <tr key={d.term} className="border-t border-line">
                    <td className="py-1.5 pr-2 font-semibold capitalize">{d.term}</td>
                    <td className="py-1.5 pr-2 text-right">{d.searchers}</td>
                    <td className="py-1.5 text-right">
                      {d.zero_share >= 0.5 ? (
                        <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold">{t('partner.notFound')}</span>
                      ) : (
                        t('partner.farmsTypical', { n: d.typical_results })
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-soil">{t('partner.none')}</p>
          )}
        </section>

        <section className="card gap-3 p-4" aria-labelledby="onsale">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 id="onsale" className="text-lg font-bold">
                {t('partner.onSale')}
              </h2>
              <p className="text-sm text-soil">{t('partner.onSaleHint')}</p>
            </div>
            <Link
              href={county ? `/prices?county=${county.code}` : '/prices'}
              className="shrink-0 text-sm font-bold text-sprout-deep underline"
            >
              {t('partner.priceTrends')}
            </Link>
          </div>
          {data.on_sale.length ? (
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-soil">
                <tr>
                  <th className="py-1 pr-2 font-semibold">{t('partner.product')}</th>
                  <th className="py-1 pr-2 text-right font-semibold">{t('prices.farms')}</th>
                  <th className="py-1 text-right font-semibold">{t('prices.median')}</th>
                </tr>
              </thead>
              <tbody>
                {data.on_sale.map((r) => (
                  <tr key={`${r.product}|${r.unit}`} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold">{productName(r.product)}</span>{' '}
                      <span className="text-xs text-soil">{t('farm.per', { unit: unitName(r.unit) })}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{r.farms}</td>
                    <td className="py-1.5 text-right">{kes(r.median_kes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-soil">{t('partner.none')}</p>
          )}
        </section>

        <section className="card gap-3 p-4" aria-labelledby="types">
          <h2 id="types" className="text-lg font-bold">
            {t('partner.byType')}
          </h2>
          {data.farms.by_type.length ? (
            <BarList
              rows={data.farms.by_type.map((x) => ({ key: x.slug, label: catName(x.slug), value: x.farms, note: String(x.farms) }))}
              max={maxType}
            />
          ) : (
            <p className="text-sm text-soil">{t('partner.none')}</p>
          )}
        </section>

        {!data.trade.hidden && data.trade.top_products.length ? (
          <section className="card gap-3 p-4" aria-labelledby="sold">
            <div>
              <h2 id="sold" className="text-lg font-bold">
                {t('partner.sold')}
              </h2>
              <p className="text-sm text-soil">{t('partner.soldHint', { n: data.min_count })}</p>
            </div>
            <BarList
              rows={data.trade.top_products.map((x) => ({
                key: x.product,
                label: productName(x.product),
                value: Number(x.value_kes),
                note: `${kes(x.value_kes)} · ${t('partner.ordersN', { n: x.orders })}`,
              }))}
            />
          </section>
        ) : null}

        {!data.vets.hidden && data.vets.by_animal.length ? (
          <section className="card gap-3 p-4" aria-labelledby="vetsby">
            <h2 id="vetsby" className="text-lg font-bold">
              {t('partner.vetsBy')}
            </h2>
            <BarList
              rows={data.vets.by_animal.map((x) => ({
                key: x.animal,
                label: x.animal === 'other' ? t('partner.other') : catName(x.animal),
                value: x.requests,
                note: String(x.requests),
              }))}
            />
          </section>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-soil">
        {t('partner.privacy', { n: data.min_count })}{' '}
        {t('partner.asOf', {
          date: format.dateTime(new Date(data.as_of), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
        })}
      </p>
    </main>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap ${
        active ? 'border-forest bg-forest text-white' : 'border-line bg-surface text-forest hover:bg-mint'
      }`}
    >
      {children}
    </Link>
  );
}

function Tile({ icon, label, value, children }: { icon: IconName; label: string; value: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-soil">
        <Icon name={icon} size={16} className="text-sprout-deep" />
        {label}
      </span>
      <span className="text-[28px] leading-tight font-extrabold tabular-nums">{value}</span>
      <span className="text-xs text-soil">{children}</span>
    </li>
  );
}

// Horizontal bars, one hue; the value is written beside each bar.
function BarList({
  rows,
  max,
  tone = 'sprout',
  capitalize = false,
}: {
  rows: { key: string; label: string; value: number; note: string }[];
  max?: number;
  tone?: 'sprout' | 'amber';
  /** search words are stored in lower case */
  capitalize?: boolean;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className={`truncate font-semibold ${capitalize ? 'capitalize' : ''}`}>{r.label}</span>
            <span className="shrink-0 text-xs text-soil tabular-nums">{r.note}</span>
          </div>
          <div className="h-2 rounded-full bg-mint">
            <div
              className={`h-2 rounded-full ${tone === 'amber' ? 'bg-amber' : 'bg-sprout-deep'}`}
              style={{ width: `${Math.max(3, (r.value / top) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

import { titled } from '@/lib/titles';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Icon, CATEGORY_ICON } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { PriceChart } from '@/components/insight/PriceChart';
import { Sparkline } from '@/components/insight/Sparkline';
import { priceIndex, unmetDemand, type PriceSeries } from '@/domains/insights/queries';
import { listFarmCategories, listPilotCounties, listProducts } from '@/domains/reference/queries';
import { kes } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export const generateMetadata = titled('prices', {
  description: 'Weekly median farm prices by county in Kenya: milk, eggs, chicken, fish, vegetables and more, from farms on i12farm.',
});

type Search = { searchParams: Promise<{ county?: string; cat?: string; p?: string; u?: string }> };

export default async function PricesPage({ searchParams }: Search) {
  const sp = await searchParams;
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const [counties, products, categories] = await Promise.all([listPilotCounties(), listProducts(locale), listFarmCategories(locale)]);
  const county = counties?.find((c) => String(c.code) === sp.county) ?? null;
  const [series, wanted] = await Promise.all([priceIndex(county?.code ?? null, 12), unmetDemand(county?.code ?? null)]);

  const product = (slug: string) => products.find((p) => p.slug === slug);
  const unitName = (u: string) => (t.has(`units.${u}`) ? t(`units.${u}` as never) : u);
  const where = county?.name ?? t('prices.kenya');

  // Only series that are on sale this week (the last point is the current week).
  const thisWeek = series.reduce((w, s) => (s.points.at(-1)!.week > w ? s.points.at(-1)!.week : w), '');
  const current = series.filter((s) => s.points.at(-1)!.week === thisWeek);
  const cats = [...new Set(current.map((s) => product(s.product)?.category).filter((c): c is string => Boolean(c)))];
  const shown = current
    .filter((s) => !sp.cat || product(s.product)?.category === sp.cat)
    .sort((a, b) => b.points.at(-1)!.farms - a.points.at(-1)!.farms || a.product.localeCompare(b.product));
  const selected: PriceSeries | undefined =
    current.find((s) => s.product === sp.p && s.unit === sp.u) ?? (sp.p ? current.find((s) => s.product === sp.p) : undefined);

  const href = (next: Partial<{ county: string | null; cat: string | null; p: string | null; u: string | null }>) => {
    const q = new URLSearchParams();
    const v = { county: county ? String(county.code) : null, cat: sp.cat ?? null, p: sp.p ?? null, u: sp.u ?? null, ...next };
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val);
    const s = q.toString();
    return s ? `/prices?${s}` : '/prices';
  };

  return (
    <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-24 pt-8 lg:max-w-6xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-extrabold tracking-tight">{t('prices.title')}</h1>
          <p className="max-w-[60ch] text-soil">{t('prices.subtitle')}</p>
        </div>
        <div className="lg:hidden">
          <LanguageSwitch />
        </div>
      </header>

      <nav aria-label={t('prices.countyLabel')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
        <Chip href={href({ county: null, p: null, u: null })} active={!county}>
          {t('prices.kenya')}
        </Chip>
        {(counties ?? []).map((c) => (
          <Chip key={c.code} href={href({ county: String(c.code), p: null, u: null })} active={county?.code === c.code}>
            {c.name}
          </Chip>
        ))}
      </nav>

      {selected ? (
        <section className="card gap-4 p-4 lg:p-6" aria-labelledby="price-detail">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="price-detail" className="text-xl font-extrabold">
                {product(selected.product)?.name ?? selected.product}
              </h2>
              <p className="text-sm text-soil">{t('prices.perIn', { unit: unitName(selected.unit), where })}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold tabular-nums">{kes(selected.points.at(-1)!.median_kes)}</p>
              <Change series={selected} label={(pct) => t('prices.change', { pct })} same={t('prices.noChange')} />
            </div>
          </div>
          <PriceChart
            locale={locale}
            points={selected.points.map((p) => ({ week: p.week, median: p.median_kes, min: p.min_kes, max: p.max_kes, farms: p.farms }))}
            labels={{
              median: t('prices.median'),
              range: t('prices.range'),
              farms: t('prices.farmsN', { n: 999 }).replace('999', '{n}'),
              week: t('prices.weekOf', { date: '{date}' }),
              chart: t('prices.chartLabel', { product: product(selected.product)?.name ?? selected.product, where }),
            }}
          />
          <details className="text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-sprout-deep">{t('prices.showTable')}</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left tabular-nums">
                <thead className="text-soil">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">{t('prices.week')}</th>
                    <th className="py-1 pr-3 font-semibold">{t('prices.median')}</th>
                    <th className="py-1 pr-3 font-semibold">{t('prices.range')}</th>
                    <th className="py-1 font-semibold">{t('prices.farms')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...selected.points].reverse().map((p) => (
                    <tr key={p.week} className="border-t border-line">
                      <td className="py-1 pr-3">{p.week}</td>
                      <td className="py-1 pr-3">{kes(p.median_kes)}</td>
                      <td className="py-1 pr-3">
                        {kes(p.min_kes)} – {kes(p.max_kes)}
                      </td>
                      <td className="py-1">{p.farms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/?q=${encodeURIComponent(product(selected.product)?.name ?? selected.product)}${county ? `&county=${county.code}` : ''}`}
              className="btn-primary h-11 min-h-11 w-auto px-5 text-sm"
            >
              {t('prices.findFarms')}
            </Link>
            <Link
              href={href({ p: null, u: null })}
              className="inline-flex h-11 items-center rounded-full border border-line px-5 text-sm font-semibold"
            >
              {t('prices.close')}
            </Link>
          </div>
        </section>
      ) : null}

      {cats.length > 1 ? (
        <nav aria-label={t('prices.typeLabel')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
          <Chip href={href({ cat: null })} active={!sp.cat} small>
            {t('explore.all')}
          </Chip>
          {cats.map((c) => (
            <Chip key={c} href={href({ cat: c })} active={sp.cat === c} small>
              {categories?.find((x) => x.slug === c)?.name ?? c}
            </Chip>
          ))}
        </nav>
      ) : null}

      {shown.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => {
            const last = s.points.at(-1)!;
            const p = product(s.product);
            const active = selected === s;
            return (
              <li key={`${s.product}|${s.unit}`} className="min-w-0">
                <Link
                  href={href({ p: s.product, u: s.unit })}
                  aria-current={active ? 'true' : undefined}
                  className={`flex h-full flex-col gap-2 rounded-2xl border bg-surface p-4 transition hover:border-sprout ${
                    active ? 'border-sprout ring-2 ring-sprout/30' : 'border-line'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mint text-sprout-deep">
                        <Icon name={CATEGORY_ICON[p?.category ?? ''] ?? 'leaf'} size={20} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate font-bold">{p?.name ?? s.product}</h3>
                        <p className="text-xs text-soil">{t('farm.per', { unit: unitName(s.unit) })}</p>
                      </div>
                    </div>
                    <Sparkline values={s.points.map((x) => x.median_kes)} label={t('prices.trend')} />
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
                    <p className="text-xl font-extrabold tabular-nums">{kes(last.median_kes)}</p>
                    <Change series={s} label={(pct) => t('prices.change', { pct })} same={t('prices.noChange')} />
                  </div>
                  <p className="text-xs text-soil">
                    {last.farms > 1 ? `${kes(last.min_kes)} – ${kes(last.max_kes)} · ` : ''}
                    {t('prices.farmsN', { n: last.farms })}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="card text-soil">{t('prices.empty', { where })}</p>
      )}

      <section className="flex flex-col gap-2.5" aria-labelledby="wanted">
        <h2 id="wanted" className="text-lg font-bold">
          {t('prices.wantedTitle', { where })}
        </h2>
        {wanted.length ? (
          <>
            <ul className="flex flex-wrap gap-2">
              {wanted.map((w) => (
                <li key={w.term} className="inline-flex items-center gap-2 rounded-full bg-amber/15 px-3.5 py-2 text-sm font-semibold">
                  <span className="capitalize">{w.term}</span>
                  <span className="text-xs font-normal text-soil">{t('prices.buyersN', { n: w.searchers })}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-soil">{t('prices.wantedHint')}</p>
            <Link href="/my-farm/new" className="inline-flex min-h-11 items-center self-start text-sm font-bold text-sprout-deep underline">
              {t('prices.listYours')}
            </Link>
          </>
        ) : (
          <p className="text-sm text-soil">{t('prices.wantedNone')}</p>
        )}
      </section>

      <p className="text-xs leading-relaxed text-soil">{t('prices.method')}</p>
    </main>
  );
}

function Chip({ href, active, small, children }: { href: string; active: boolean; small?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex shrink-0 items-center rounded-full border px-4 font-semibold whitespace-nowrap h-11 text-sm ${
        active ? 'border-forest bg-forest text-surface' : 'border-line bg-surface text-forest hover:bg-mint'
      }`}
    >
      {children}
    </Link>
  );
}

// Change in the median over the last 4 weeks (or since the first week shown).
function Change({ series, label, same }: { series: PriceSeries; label: (pct: string) => string; same: string }) {
  const pts = series.points;
  if (pts.length < 2) return null;
  const now = pts.at(-1)!.median_kes;
  const then = pts[Math.max(0, pts.length - 5)].median_kes;
  if (!then) return null;
  const pct = Math.round(((now - then) / then) * 100);
  if (pct === 0) return <span className="text-xs font-semibold text-soil">{same}</span>;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-soil tabular-nums">
      <span aria-hidden="true">{pct > 0 ? '▲' : '▼'}</span>
      {label(`${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`)}
    </span>
  );
}

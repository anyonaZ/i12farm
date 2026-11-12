import { titled } from '@/lib/titles';
import Link from 'next/link';
import { PushToggle } from '@/components/notify/PushToggle';
import { getLocale, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { FarmCover } from '@/components/farm/FarmCover';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { getPilotProgress, listManagedFarmRows, listManagedFarms, listSavedFarms } from '@/domains/farms/queries';
import { listProducts } from '@/domains/reference/queries';
import { unreadTotal } from '@/domains/messaging/queries';
import { featuredUntil } from '@/domains/promotions/queries';
import { farmOrdersNeedingAction } from '@/domains/orders/queries';
import { displayName, requireViewer } from '@/lib/auth/viewer';
import type { Locale } from '@/i18n/config';
import { FarmList } from './FarmList';
import { ManagedFarmCard } from './ManagedFarmCard';

export const generateMetadata = titled('myFarm');

const PILOT_TARGET = 100;
// More farms than this (agents) → a searchable list; each farm's tools open on its own page.
const CARD_LIMIT = 2;

export default async function MyFarmPage({ searchParams }: { searchParams: Promise<{ photosFailed?: string }> }) {
  const t = await getTranslations();
  const viewer = await requireViewer('/my-farm');
  const locale = (await getLocale()) as Locale;
  const { photosFailed } = await searchParams;
  const isAgent = viewer.roles.includes('agent');
  const isAdmin = viewer.roles.includes('admin');
  const rows = await listManagedFarmRows(viewer.id);
  const [farms, saved, progress, needAction, unread, products] = await Promise.all([
    rows.length > CARD_LIMIT ? Promise.resolve([]) : listManagedFarms(viewer.id),
    listSavedFarms(viewer.id),
    isAgent ? getPilotProgress() : Promise.resolve([]),
    farmOrdersNeedingAction(viewer),
    unreadTotal(viewer),
    rows.length > CARD_LIMIT ? Promise.resolve([]) : listProducts(locale),
  ]);
  const name = displayName(viewer);
  const until = await featuredUntil(
    viewer,
    farms.map((f) => f.id),
  );
  const total = progress.reduce((s, r) => s + Number(r.farms), 0);
  const mine = progress.reduce((s, r) => s + Number(r.mine), 0);
  const maxCounty = Math.max(1, ...progress.map((r) => Number(r.farms)));

  return (
    <main className="mx-auto w-full flex flex-col gap-5 px-4 pb-24 pt-8 lg:max-w-5xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold tracking-tight">{isAgent ? t('myFarm.agentTitle') : t('myFarm.title')}</h1>
          <p className="mt-1 truncate text-soil">{t('myFarm.signedInAs', { name })}</p>
        </div>
        <LanguageSwitch />
      </header>

      {rows.length ? <PushToggle compact prompt={t('notify.promptFarm')} /> : null}
      <nav className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={t('myFarmPlus.account')}>
        <Link
          href="/orders"
          className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 text-sm font-bold"
        >
          <Icon name="bag" className="shrink-0 text-sprout-deep" />
          <span className="min-w-0">
            <span className="block">{t('myFarmPlus.orders')}</span>
            {rows.length ? (
              <span className={`block truncate text-xs ${needAction ? 'text-sprout-deep' : 'font-medium text-soil'}`}>
                {t('myFarmPlus.needAction', { n: needAction })}
              </span>
            ) : null}
          </span>
        </Link>
        <Link
          href="/inbox"
          className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 text-sm font-bold"
        >
          <Icon name="chat" className="shrink-0 text-sprout-deep" />
          <span className="min-w-0">
            <span className="block">{t('myFarmPlus.inbox')}</span>
            {unread ? <span className="block truncate text-xs text-sprout-deep">{t('myFarmPlus.unread', { n: unread })}</span> : null}
          </span>
        </Link>
        <Link
          href="/account"
          className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 text-sm font-bold"
        >
          <Icon name="user" className="shrink-0 text-sprout-deep" />
          {t('myFarmPlus.account')}
        </Link>
        <Link
          href="/prices"
          className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 text-sm font-bold"
        >
          <Icon name="trend" className="shrink-0 text-sprout-deep" />
          {t('prices.title')}
        </Link>
        {viewer.roles.includes('partner') || isAdmin ? (
          <Link
            href="/partner"
            className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 text-sm font-bold"
          >
            <Icon name="chart" className="shrink-0 text-sprout-deep" />
            {t('nav.partner')}
          </Link>
        ) : null}
        {isAdmin ? (
          <Link
            href="/admin"
            className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 text-sm font-bold"
          >
            <Icon name="shield" className="shrink-0 text-sprout-deep" />
            {t('myFarmPlus.admin')}
          </Link>
        ) : null}
      </nav>

      {photosFailed ? (
        <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
          {t('wizard.photoFailed', { n: Number(photosFailed) })}
        </p>
      ) : null}

      {isAgent ? (
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start">
          <section className="card gap-3 border-ink bg-ink text-white">
            <span className="text-sm text-white/75">{t('myFarm.pilotTarget')}</span>
            <h2 className="text-[22px] font-extrabold tabular-nums">{t('myFarm.target', { n: total })}</h2>
            <div
              className="h-3 overflow-hidden rounded-full bg-white/20"
              role="progressbar"
              aria-label={t('myFarm.pilotTarget')}
              aria-valuetext={t('myFarm.target', { n: total })}
              aria-valuemin={0}
              aria-valuemax={PILOT_TARGET}
              aria-valuenow={total}
            >
              <i className="block h-full rounded-full bg-lime" style={{ width: `${Math.min(100, (total / PILOT_TARGET) * 100)}%` }} />
            </div>
            <p className="text-sm text-white/75">{t('myFarm.yours', { n: mine })}</p>
            <Link href="/my-farm/new" className="btn-primary bg-lime text-ink">
              <Icon name="plus" size={18} />
              {t('myFarm.enrolCta')}
            </Link>
          </section>
          <section className="card">
            <h2 className="text-lg font-bold">{t('myFarm.byCounty')}</h2>
            <ul className="flex flex-col gap-2.5">
              {progress.map((r) => (
                <li key={r.county_code} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2.5 text-sm">
                  <span>{r.county_name}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-mint">
                    <i className="block h-full rounded-full bg-sprout" style={{ width: `${(Number(r.farms) / maxCounty) * 100}%` }} />
                  </span>
                  <b className="text-right tabular-nums">{r.farms}</b>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">{isAgent ? t('myFarm.managed') : t('myFarm.myFarms')}</h2>
          {rows.length > CARD_LIMIT ? (
            <FarmList farms={rows} />
          ) : (
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
              {farms.map((f) => (
                <ManagedFarmCard key={f.id} farm={f} until={until[f.id] ?? null} viewer={viewer} locale={locale} products={products} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!isAgent ? (
        <section className="card gap-3 border-ink bg-ink text-white">
          <h2 className="text-lg font-bold">{rows.length ? t('myFarm.addFarm') : t('myFarm.haveFarm')}</h2>
          <p className="text-sm text-white/75">{t('myFarm.haveFarmD')}</p>
          <Link href="/my-farm/new" className="btn-primary bg-lime text-ink">
            <Icon name="pin" size={18} />
            {t('wizard.pinTitle')}
          </Link>
        </section>
      ) : null}

      <section className="card">
        <h2 className="text-lg font-bold">{t('myFarm.savedTitle')}</h2>
        {saved.length ? (
          <ul className="flex flex-col">
            {saved.map((f) => (
              <li key={f.id} className="border-t border-line first:border-t-0">
                <Link href={`/f/${f.slug}`} className="flex items-center gap-3 py-2.5">
                  <span className="size-12 shrink-0 overflow-hidden rounded-xl">
                    <FarmCover id={f.id} name={f.name} category={f.categories[0]} sizes="48px" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{f.name}</span>
                    <span className="block truncate text-sm text-soil">{[f.place_name, f.county?.name].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-soil">{t('myFarm.savedEmpty')}</p>
        )}
      </section>

      <form action="/auth/sign-out" method="post">
        <button type="submit" className="btn-secondary">
          {t('myFarm.signOut')}
        </button>
      </form>
    </main>
  );
}

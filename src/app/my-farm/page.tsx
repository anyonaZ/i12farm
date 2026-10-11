import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { FarmCover } from '@/components/farm/FarmCover';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { getPilotProgress, listManagedFarms, listSavedFarms } from '@/domains/farms/queries';
import type { Locale } from '@/i18n/config';
import { PriceEditor } from './PriceEditor';

export const metadata = { title: 'My Farm' };

const PILOT_TARGET = 100;

export default async function MyFarmPage({ searchParams }: { searchParams: Promise<{ photosFailed?: string }> }) {
  const t = await getTranslations();
  if (!isSupabaseConfigured) redirect('/sign-in?next=/my-farm');

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/sign-in?next=/my-farm');

  const locale = (await getLocale()) as Locale;
  const { photosFailed } = await searchParams;
  const { data: profile } = await supabase.from('profiles').select('full_name, roles').eq('id', data.user.id).maybeSingle();
  const roles: string[] = profile?.roles ?? [];
  const isAgent = roles.includes('agent');
  const [farms, saved, progress] = await Promise.all([
    listManagedFarms(data.user.id),
    listSavedFarms(data.user.id),
    isAgent ? getPilotProgress() : Promise.resolve([]),
  ]);
  const name = profile?.full_name || data.user.email || '';
  const total = progress.reduce((s, r) => s + Number(r.farms), 0);
  const mine = progress.reduce((s, r) => s + Number(r.mine), 0);
  const maxCounty = Math.max(1, ...progress.map((r) => Number(r.farms)));

  return (
    <main className="flex flex-col gap-5 px-4 pb-24 pt-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold tracking-tight">{isAgent ? t('myFarm.agentTitle') : t('myFarm.title')}</h1>
          <p className="mt-1 truncate text-soil">{t('myFarm.signedInAs', { name })}</p>
        </div>
        <LanguageSwitch />
      </header>

      {photosFailed ? (
        <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
          {t('wizard.photoFailed', { n: Number(photosFailed) })}
        </p>
      ) : null}

      {isAgent ? (
        <>
          <section className="card gap-3 border-forest bg-forest text-white">
            <span className="text-sm text-white/75">{t('myFarm.pilotTarget')}</span>
            <h2 className="text-[22px] font-extrabold tabular-nums">{t('myFarm.target', { n: total })}</h2>
            <div
              className="h-3 overflow-hidden rounded-full bg-white/20"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={PILOT_TARGET}
              aria-valuenow={total}
            >
              <i className="block h-full rounded-full bg-lime" style={{ width: `${Math.min(100, (total / PILOT_TARGET) * 100)}%` }} />
            </div>
            <p className="text-sm text-white/75">{t('myFarm.yours', { n: mine })}</p>
            <Link href="/my-farm/new" className="btn-primary bg-lime text-forest">
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
        </>
      ) : null}

      {farms.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">{isAgent ? t('myFarm.managed') : t('myFarm.myFarms')}</h2>
          {farms.map((f) => (
            <article key={f.id} className="card">
              <div className="flex items-center gap-3">
                <span className="size-16 shrink-0 overflow-hidden rounded-2xl">
                  <FarmCover id={f.id} name={f.name} category={f.categories[0]} coverPath={f.media[0]?.storage_path} sizes="64px" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold">{f.name}</h3>
                  <p className="truncate text-sm text-soil">{[f.place_name, f.county?.name].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2">
                <Stat label={t('myFarm.views')} value={f.stats.views} />
                <Stat label={t('myFarm.calls')} value={f.stats.calls} />
                <Stat label={t('myFarm.whatsapps')} value={f.stats.whatsapps} />
              </dl>
              <h4 className="font-bold">{t('myFarm.productsTitle')}</h4>
              <div>
                {f.listings.map((l) => (
                  <PriceEditor
                    key={l.id}
                    listingId={l.id}
                    name={l.product ? (locale === 'sw' ? l.product.name_sw : l.product.name_en) : l.title}
                    unitLabel={t('farm.per', { unit: t(`units.${l.unit}`) })}
                    price={l.price_kes === null ? null : Number(l.price_kes)}
                    history={f.history[l.id] ?? []}
                  />
                ))}
              </div>
              <Link href={`/f/${f.slug}`} className="btn-secondary">
                {t('myFarm.viewPublic')}
              </Link>
            </article>
          ))}
        </section>
      ) : null}

      {!isAgent ? (
        <section className="card gap-3 border-forest bg-forest text-white">
          <h2 className="text-lg font-bold">{farms.length ? t('myFarm.addFarm') : t('myFarm.haveFarm')}</h2>
          <p className="text-sm text-white/75">{t('myFarm.haveFarmD')}</p>
          <Link href="/my-farm/new" className="btn-primary bg-lime text-forest">
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col-reverse rounded-2xl bg-mint p-3">
      <dt className="text-xs text-soil">{label}</dt>
      <dd className="text-[22px] font-extrabold tabular-nums">{value}</dd>
    </div>
  );
}

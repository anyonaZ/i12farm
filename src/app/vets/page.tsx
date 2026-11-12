import { titled } from '@/lib/titles';
import Link from 'next/link';
import { PushToggle } from '@/components/notify/PushToggle';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { listCounties, listFarmCategories } from '@/domains/reference/queries';
import { listVetCounties, listVetFarms, myVetFarms, myVetRequests, vetInbox } from '@/domains/vets/queries';
import { getViewer } from '@/lib/auth/viewer';
import { displayPhone } from '@/lib/phone';
import type { Locale } from '@/i18n/config';
import { VetRequestForm } from './VetRequestForm';
import { RequestActions, TakeRequest } from './VetActions';

export const generateMetadata = titled('vets');

const ANIMALS = ['dairy', 'beef', 'poultry', 'goats', 'sheep', 'pigs', 'rabbits', 'fish', 'bees'];

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-amber/20 text-forest',
  accepted: 'bg-sprout/15 text-sprout-deep',
  completed: 'bg-mint text-forest',
  cancelled: 'bg-line text-forest',
  expired: 'bg-line text-forest',
};

export default async function VetsPage() {
  const t = await getTranslations('vets');
  const tn = await getTranslations('notify');
  const locale = (await getLocale()) as Locale;
  const format = await getFormatter();
  const viewer = await getViewer();
  const [counties, categories, vets, mine, myFarms, inbox, vetCounties] = await Promise.all([
    listCounties(),
    listFarmCategories(locale),
    listVetFarms(viewer?.countyCode ?? null),
    viewer ? myVetRequests(viewer) : Promise.resolve([]),
    viewer ? myVetFarms(viewer) : Promise.resolve([]),
    viewer ? vetInbox(viewer) : Promise.resolve([]),
    listVetCounties(),
  ]);
  const animalName = (slug: string) => categories?.find((c) => c.slug === slug)?.name ?? slug;
  const animals = ANIMALS.map((slug) => ({ slug, name: animalName(slug) }));
  const when = (iso: string) => format.relativeTime(new Date(iso));

  const askColumn = (
    <div className="flex flex-col gap-5">
      {viewer ? (
        <VetRequestForm
          counties={counties ?? []}
          vetCounties={vetCounties}
          animals={animals}
          defaultCounty={viewer.countyCode}
          defaultPhone={displayPhone(viewer.phone ?? viewer.contactPhone)}
        />
      ) : (
        <section className="card items-start gap-3">
          <h2 className="text-lg font-bold">{t('request')}</h2>
          <Link href="/sign-in?next=/vets" className="btn-primary w-auto">
            {t('signIn')}
          </Link>
        </section>
      )}
    </div>
  );
  const vetColumn = (
    <div className="flex flex-col gap-5">
      {myFarms.length ? <PushToggle compact prompt={tn('promptVet')} /> : null}
      {myFarms.length ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-lg font-bold">{t('inbox')}</h2>
          <p className="text-sm text-soil">{t('inboxHint')}</p>
          {inbox.length ? (
            <ul className="flex flex-col gap-2">
              {inbox.map((r) => (
                <li key={r.id} className="card gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {animalName(r.animal)} · {r.place ?? r.county_name}
                      </p>
                      <p className="text-sm text-soil">
                        {r.number} · {r.county_name} · {when(r.created_at)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${r.urgency === 'today' ? 'bg-amber/25' : 'bg-mint'}`}
                    >
                      {t(r.urgency === 'today' ? 'today_short' : 'week_short')}
                    </span>
                  </div>
                  {r.description ? <p className="text-sm">“{r.description}”</p> : null}
                  {r.status === 'open' ? (
                    <TakeRequest
                      requestId={r.id}
                      farms={myFarms.filter((f) => f.county_code === r.county_code).map((f) => ({ id: f.id, name: f.name }))}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                      <span className="text-sm font-semibold text-sprout-deep">
                        {t('yours', { farm: r.vet_farm_name ?? '' })} · {t(`status.${r.status}`)}
                      </span>
                      {r.contact_phone ? (
                        <a href={`tel:+${r.contact_phone}`} className="btn-secondary min-h-11 w-auto px-4 text-sm">
                          <Icon name="phone" size={16} />
                          {r.contact_name ? `${r.contact_name} · ` : ''}
                          {displayPhone(r.contact_phone)}
                        </a>
                      ) : null}
                      {r.status === 'accepted' ? <RequestActions requestId={r.id} canCancel={false} canComplete /> : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="card text-soil">{t('inboxNone')}</p>
          )}
        </section>
      ) : null}

      {viewer ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-lg font-bold">{t('mine')}</h2>
          {mine.length ? (
            <ul className="flex flex-col gap-2">
              {mine.map((r) => (
                <li key={r.id} className="card gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {animalName(r.animal)} · {r.place ?? r.county_name}
                      </p>
                      <p className="text-sm text-soil">
                        {r.number} · {when(r.created_at)} · {t('alerted', { count: r.vets_alerted })}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[r.status]}`}>
                      {t(`status.${r.status}`)}
                    </span>
                  </div>
                  {r.vet_name ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-mint p-3">
                      <span className="text-sm font-semibold">
                        {r.vet_farm_slug ? (
                          <Link href={`/f/${r.vet_farm_slug}`} className="underline">
                            {t('vetIs', { name: r.vet_name })}
                          </Link>
                        ) : (
                          t('vetIs', { name: r.vet_name })
                        )}
                      </span>
                      {r.vet_phone ? (
                        <a href={`tel:+${r.vet_phone}`} className="btn-primary min-h-11 w-auto px-4 text-sm">
                          <Icon name="phone" size={16} />
                          {t('call')} {displayPhone(r.vet_phone)}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  {r.status === 'open' || r.status === 'accepted' ? (
                    <RequestActions requestId={r.id} canCancel canComplete={r.status === 'accepted'} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="card text-soil">{t('none')}</p>
          )}
        </section>
      ) : null}

      {vets.length ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-lg font-bold">{t('nearby')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {vets.map((v) => (
              <li key={v.id}>
                <Link href={`/f/${v.slug}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:bg-mint">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sprout/15 text-sprout-deep">
                    <Icon name="cross" size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 truncate font-bold">
                      {v.name}
                      {v.verified ? <Icon name="badge" size={14} className="shrink-0 text-sprout-deep" /> : null}
                    </span>
                    <span className="block truncate text-sm text-soil">
                      {v.place_name ? `${v.place_name}, ` : ''}
                      {v.county_name}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!myFarms.length ? <p className="text-sm text-soil">{t('becomeVet')}</p> : null}
        </section>
      ) : null}
    </div>
  );

  return (
    <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-24 pt-8 lg:max-w-6xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-extrabold tracking-tight">{t('title')}</h1>
          <p className="max-w-[52ch] text-soil">{t('subtitle')}</p>
        </div>
        <div className="lg:hidden">
          <LanguageSwitch />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        {/* A vet sees requests for them before the form for asking a vet (also for screen readers). */}
        {/* A vet sees requests for them before the form for asking a vet (also for screen readers). */}
        {myFarms.length ? (
          <>
            {vetColumn}
            {askColumn}
          </>
        ) : (
          <>
            {askColumn}
            {vetColumn}
          </>
        )}
      </div>
    </main>
  );
}

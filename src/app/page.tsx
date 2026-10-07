import { getLocale, getTranslations } from 'next-intl/server';
import { Logo } from '@/components/Logo';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { listFarmCategories } from '@/domains/reference/queries';
import type { Locale } from '@/i18n/config';

// Phase 0 Explore screen: the real shell (header, search pill, category chips,
// bottom nav) around a placeholder where the MapLibre map lands in Phase 1.
export default async function ExplorePage() {
  const t = await getTranslations('explore');
  const tApp = await getTranslations('app');
  const locale = (await getLocale()) as Locale;
  const categories = await listFarmCategories(locale);

  return (
    <main className="flex flex-col gap-5 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Logo />
        <LanguageSwitch />
      </header>

      <div
        role="search"
        className="flex min-h-14 items-center gap-3 rounded-full border border-line bg-surface px-5 text-soil shadow-sm"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <span className="text-base">{t('searchPlaceholder')}</span>
      </div>

      <section aria-labelledby="map-coming" className="relative overflow-hidden rounded-card bg-forest p-6 text-white">
        <MapSketch />
        <div className="relative">
          <p className="mb-2 inline-block rounded-full bg-lime px-3 py-1 text-xs font-bold text-forest">Homa Bay · Kisumu</p>
          <h1 id="map-coming" className="text-2xl font-extrabold leading-tight">
            {t('comingTitle')}
          </h1>
          <p className="mt-3 max-w-[30ch] text-base leading-relaxed text-white/85">{t('comingBody')}</p>
        </div>
      </section>

      <section aria-labelledby="cats">
        <h2 id="cats" className="mb-3 text-lg font-bold">
          {t('categoriesTitle')}
        </h2>
        {categories ? (
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.slug} className="chip">
                <span className="size-2 rounded-full bg-sprout" aria-hidden="true" />
                {c.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-soil">{t('categoriesUnavailable')}</p>
        )}
      </section>

      <p className="pb-2 text-center text-xs text-soil">{tApp('tagline')}</p>
    </main>
  );
}

// Decorative contour lines and pins behind the hero, a hint of the map to come.
function MapSketch() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="#12B76A" strokeOpacity="0.28" strokeWidth="1.5">
        <path d="M-10 200C60 170 120 210 190 180S330 120 410 150" />
        <path d="M-10 230C70 200 130 240 200 210S340 150 410 180" />
        <path d="M200 -10C230 40 300 50 330 100S380 190 410 200" />
      </g>
      <g fill="#B6F04A">
        <circle cx="300" cy="70" r="6" />
        <circle cx="345" cy="120" r="6" />
        <circle cx="270" cy="150" r="6" />
        <circle cx="365" cy="190" r="6" />
      </g>
      <g fill="#12B76A">
        <circle cx="300" cy="70" r="14" fillOpacity="0.25" />
        <circle cx="345" cy="120" r="14" fillOpacity="0.25" />
      </g>
    </svg>
  );
}

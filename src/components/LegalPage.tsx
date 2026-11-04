import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { CONTACT, UPDATED, type LegalSection } from '@/content/legal';

export async function LegalPage({ doc }: { doc: Record<'en' | 'sw', { title: string; intro: string; sections: LegalSection[] }> }) {
  const locale = (await getLocale()) === 'sw' ? 'sw' : 'en';
  const t = await getTranslations('legal');
  const format = await getFormatter();
  const d = doc[locale];
  return (
    <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-24 pt-6 lg:max-w-2xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="grid size-11 place-items-center rounded-full border border-line bg-surface" aria-label={t('back')}>
          <Icon name="back" />
        </Link>
        <div className="lg:hidden">
          <LanguageSwitch />
        </div>
      </header>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold tracking-tight">{d.title}</h1>
        <p className="text-sm text-soil">
          {t('updated', { date: format.dateTime(new Date(`${UPDATED}T12:00:00+03:00`), { dateStyle: 'long' }) })}
        </p>
      </div>
      <p className="text-lg">{d.intro}</p>
      {d.sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{s.heading}</h2>
          {s.body.some((p) => p.startsWith('- ')) ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              {s.body.map((p) => (
                <li key={p}>{p.replace(/^- /, '')}</li>
              ))}
            </ul>
          ) : (
            s.body.map((p) => <p key={p}>{p}</p>)
          )}
        </section>
      ))}
      <p className="rounded-xl bg-mint p-4 text-sm">{CONTACT ? t('contact', { email: CONTACT }) : t('contactInApp')}</p>
    </main>
  );
}

/** Small links row used under forms and on account pages. */
export async function LegalLinks() {
  const t = await getTranslations('legal');
  return (
    <p className="flex justify-center gap-4 text-sm text-soil">
      <Link href="/privacy" className="inline-flex min-h-11 items-center underline">
        {t('privacy')}
      </Link>
      <Link href="/terms" className="inline-flex min-h-11 items-center underline">
        {t('terms')}
      </Link>
    </p>
  );
}

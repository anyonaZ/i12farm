import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { myBroadcasts, myOrganisation } from '@/domains/broadcasts/queries';
import { listCounties, listFarmCategories } from '@/domains/reference/queries';
import { requireViewer } from '@/lib/auth/viewer';
import type { Locale } from '@/i18n/config';
import { BroadcastComposer, WithdrawButton } from './BroadcastComposer';

export const metadata = { title: 'Partner messages', robots: { index: false } };

const STATUS_STYLE: Record<string, string> = {
  pending_review: 'bg-amber/20',
  approved: 'bg-sprout/15 text-sprout-deep',
  sent: 'bg-sprout/15 text-sprout-deep',
  rejected: 'bg-line text-soil',
  cancelled: 'bg-line text-soil',
};

export default async function PartnerPage() {
  const viewer = await requireViewer('/partner');
  const t = await getTranslations('partner');
  const format = await getFormatter();
  const locale = (await getLocale()) as Locale;
  const allowed = viewer.roles.includes('partner') || viewer.roles.includes('admin');

  if (!allowed) {
    return (
      <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-24 pt-8 lg:max-w-3xl lg:px-8 lg:pt-10">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('title')}</h1>
        <p className="card text-soil">{t('notPartner')}</p>
      </main>
    );
  }

  const [counties, categories, history, organisation] = await Promise.all([
    listCounties(),
    listFarmCategories(locale),
    myBroadcasts(viewer),
    myOrganisation(viewer),
  ]);
  const countyName = (code: number) => counties?.find((c) => c.code === code)?.name ?? String(code);
  const categoryName = (slug: string) => categories?.find((c) => c.slug === slug)?.name ?? slug;

  return (
    <main className="mx-auto flex w-full flex-col gap-5 px-4 pb-24 pt-8 lg:max-w-6xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-extrabold tracking-tight">{t('title')}</h1>
          <p className="max-w-[60ch] text-soil">{t('subtitle')}</p>
        </div>
        <div className="lg:hidden">
          <LanguageSwitch />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <BroadcastComposer
          counties={counties ?? []}
          categories={(categories ?? []).map((c) => ({ slug: c.slug, name: c.name }))}
          organisation={organisation || viewer.fullName || ''}
        />

        <section className="flex flex-col gap-2.5">
          <h2 className="text-lg font-bold">{t('history')}</h2>
          {history.length ? (
            <ul className="flex flex-col gap-2">
              {history.map((b) => (
                <li key={b.id} className="card gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-soil">
                      {format.dateTime(new Date(b.created_at), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </p>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[b.status]}`}>
                      {t(`status.${b.status}`)}
                    </span>
                  </div>
                  <p className="text-sm">{locale === 'sw' ? b.body_sw : b.body_en}</p>
                  <p className="text-xs text-soil">
                    {b.counties.length ? b.counties.map(countyName).join(', ') : t('allCounties')} ·{' '}
                    {b.categories.length ? b.categories.map(categoryName).join(', ') : t('allCategories')}
                    {b.verified_only ? ` · ${t('verifiedOnly')}` : ''}
                  </p>
                  {b.stats ? (
                    <p className="rounded-xl bg-mint px-3 py-2 text-sm font-semibold tabular-nums">
                      {t('stats', {
                        sent: b.stats.sent + b.stats.delivered,
                        delivered: b.stats.delivered,
                        failed: b.stats.failed,
                        skipped: b.stats.skipped,
                      })}
                    </p>
                  ) : null}
                  {b.review_note ? <p className="text-sm text-soil">{t('reviewNote', { note: b.review_note })}</p> : null}
                  {b.status === 'pending_review' ? <WithdrawButton id={b.id} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="card text-soil">{t('none')}</p>
          )}
        </section>
      </div>
    </main>
  );
}

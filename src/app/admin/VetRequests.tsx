import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { adminVetRequests } from '@/domains/admin/queries';
import { listFarmCategories } from '@/domains/reference/queries';
import type { Viewer } from '@/lib/auth/viewer';
import type { Locale } from '@/i18n/config';
import { VetSettingsForm } from './AdminControls';

const STATUS: Record<string, string> = {
  open: 'bg-amber/20',
  accepted: 'bg-sprout/15 text-sprout-deep',
  completed: 'bg-mint',
  cancelled: 'bg-line text-forest',
  expired: 'bg-line text-forest',
};

/** Admin → Vets: recent vet requests and how long open ones stay open. */
export async function VetRequestsView({ viewer }: { viewer: Viewer }) {
  const t = await getTranslations('admin');
  const tv = await getTranslations('vets');
  const format = await getFormatter();
  const locale = (await getLocale()) as Locale;
  const [{ requests, vetHours }, categories] = await Promise.all([adminVetRequests(viewer), listFarmCategories(locale)]);
  const categoryName = (slug: string) => categories?.find((c) => c.slug === slug)?.name ?? slug;
  const when = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('vetRequests')}</h2>
        {requests.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {requests.map((r) => (
              <li key={r.number} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <b>{r.number}</b> · {categoryName(r.animal)} · {r.county}
                  <span className="block text-xs text-soil">
                    {when(r.created_at)} · {tv('alerted', { count: r.vets_alerted })}
                    {r.vet ? ` · ${r.vet}` : ''}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${STATUS[r.status] ?? ''}`}>
                  {tv(`status.${r.status}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-soil">{tv('none')}</p>
        )}
      </section>
      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('vetSettings')}</h2>
        <VetSettingsForm vetHours={vetHours} />
      </section>
    </div>
  );
}

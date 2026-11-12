import { titled } from '@/lib/titles';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { featuredUntil, listPlans } from '@/domains/promotions/queries';
import { requireViewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';
import { pesiMode } from '@/lib/pesi';
import { displayPhone } from '@/lib/phone';
import { FeatureForm } from './FeatureForm';

export const generateMetadata = titled('featureFarm', { robots: { index: false } });

export default async function FeaturePage({ params }: { params: Promise<{ farmId: string }> }) {
  const { farmId } = await params;
  const viewer = await requireViewer(`/my-farm/feature/${farmId}`);
  if (!/^[0-9a-f-]{36}$/.test(farmId)) notFound();
  const [farm] = await withUser(
    viewer.id,
    (tx) => tx<{ id: string; name: string; slug: string; phone: string | null; mine: boolean }[]>`
    select f.id, f.name, f.slug, coalesce(f.whatsapp, f.phone_public) as phone, public.can_manage_farm(f.id) as mine
    from public.farms f where f.id = ${farmId} and f.status = 'published'`,
  );
  if (!farm?.mine) notFound();
  const [t, format, plans, until] = await Promise.all([
    getTranslations('featured'),
    getFormatter(),
    listPlans(),
    featuredUntil(viewer, [farm.id]),
  ]);
  const current = until[farm.id];

  return (
    <main className="mx-auto w-full flex flex-col gap-4 px-4 pb-28 pt-6 lg:max-w-2xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-center gap-3">
        <Link
          href="/my-farm"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface"
          aria-label={t('back')}
        >
          <Icon name="back" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">{t('title')}</h1>
          <p className="truncate text-sm text-soil">{farm.name}</p>
        </div>
      </header>
      <section className="card flex-row items-start gap-3 border-forest bg-forest text-white">
        <Icon name="star" size={22} className="mt-0.5 shrink-0 fill-lime text-lime" />
        <p className="text-sm">{t('intro')}</p>
      </section>
      {current ? (
        <p className="rounded-xl bg-lime/40 px-3 py-2.5 text-sm font-semibold">
          {t('until', {
            date: format.dateTime(new Date(current), {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Africa/Nairobi',
            }),
          })}
          {' · '}
          {t('newPlanAfter')}
        </p>
      ) : null}
      <FeatureForm
        farm={{ id: farm.id, name: farm.name }}
        plans={plans}
        defaultPhone={displayPhone(farm.phone ?? viewer.contactPhone ?? (viewer.phone ? '+' + viewer.phone : ''))}
        simulate={pesiMode === 'simulate'}
      />
    </main>
  );
}

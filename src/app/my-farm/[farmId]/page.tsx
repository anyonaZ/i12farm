import { titled } from '@/lib/titles';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { listManagedFarms } from '@/domains/farms/queries';
import { featuredUntil } from '@/domains/promotions/queries';
import { listProducts } from '@/domains/reference/queries';
import { requireViewer } from '@/lib/auth/viewer';
import type { Locale } from '@/i18n/config';
import { ManagedFarmCard } from '../ManagedFarmCard';

export const generateMetadata = titled('myFarm', { robots: { index: false } });

// One farm's tools, opened from the agent's farm list.
export default async function ManagedFarmPage({ params }: { params: Promise<{ farmId: string }> }) {
  const { farmId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(farmId)) notFound();
  const viewer = await requireViewer(`/my-farm/${farmId}`);
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations('farmEdit');
  const [farms, products] = await Promise.all([listManagedFarms(viewer.id, farmId), listProducts(locale)]);
  const farm = farms[0];
  if (!farm) notFound();
  const until = await featuredUntil(viewer, [farm.id]);
  return (
    <main className="mx-auto flex w-full flex-col gap-4 px-4 pb-24 pt-6 lg:max-w-2xl lg:px-8 lg:pb-16 lg:pt-10">
      <Link href="/my-farm" className="inline-flex min-h-11 items-center gap-2 self-start font-bold text-sprout-deep">
        <Icon name="back" size={18} />
        {t('allFarms')}
      </Link>
      <h1 className="sr-only">{farm.name}</h1>
      <ManagedFarmCard farm={farm} until={until[farm.id] ?? null} viewer={viewer} locale={locale} products={products} />
    </main>
  );
}

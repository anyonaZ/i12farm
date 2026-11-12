import { titled } from '@/lib/titles';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { farmForCheckout } from '@/domains/orders/queries';
import { getViewer } from '@/lib/auth/viewer';
import { displayPhone } from '@/lib/phone';
import { pesiMode } from '@/lib/pesi';
import { CheckoutForm } from './CheckoutForm';

export const generateMetadata = titled('checkout', { robots: { index: false } });

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ farm?: string }> }) {
  const { farm: slug } = await searchParams;
  // Opened without a farm (old bookmark, back button): the cart lives on a farm's page.
  if (!slug) redirect('/');
  const [t, viewer] = await Promise.all([getTranslations('checkout'), getViewer()]);
  const farm = await farmForCheckout(viewer, slug);
  if (!farm) notFound();
  const back = `/checkout?farm=${encodeURIComponent(slug)}`;

  return (
    <main className="mx-auto w-full flex flex-col gap-5 px-4 pb-28 pt-6 lg:max-w-2xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-center gap-3">
        <Link
          href={`/f/${farm.slug}`}
          className="grid size-11 place-items-center rounded-full border border-line bg-surface"
          aria-label={t('back')}
        >
          <Icon name="back" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">{t('title')}</h1>
          <p className="truncate text-sm text-soil">{t('from', { farm: farm.name })}</p>
        </div>
      </header>

      {farm.mine ? (
        <p className="card text-soil">{t('ownFarm')}</p>
      ) : (
        <CheckoutForm
          farm={{ id: farm.id, slug: farm.slug, name: farm.name }}
          listings={farm.listings}
          signedIn={Boolean(viewer)}
          paymentsOff={pesiMode === 'off'}
          signInHref={`/sign-in?next=${encodeURIComponent(back)}`}
          defaults={{
            name: viewer?.fullName ?? '',
            phone: displayPhone(viewer?.contactPhone ?? (viewer?.phone ? '+' + viewer.phone : '')),
          }}
        />
      )}
    </main>
  );
}

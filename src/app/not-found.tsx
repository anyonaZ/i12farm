import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';

export const metadata = { title: 'Not found', robots: { index: false } };

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <LogoMark size={56} />
      <h1 className="text-2xl font-extrabold">{t('title')}</h1>
      <p className="text-soil">{t('body')}</p>
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Link href="/" className="btn-primary">
          <Icon name="compass" size={18} />
          {t('explore')}
        </Link>
        <Link href="/orders" className="btn-secondary">
          <Icon name="bag" size={18} />
          {t('orders')}
        </Link>
      </div>
    </main>
  );
}

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LogoMark } from '@/components/Logo';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { isGoogleConfigured } from '@/lib/auth/google';
import { getViewer } from '@/lib/auth/viewer';
import { safeNextPath } from '@/lib/http';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; tab?: string }> }) {
  const t = await getTranslations('auth');
  const { next, error, tab } = await searchParams;
  const safeNext = safeNextPath(next);
  if (await getViewer()) redirect(safeNext);

  return (
    <main className="flex flex-col gap-6 px-4 pb-24 pt-6">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <div className="flex flex-col items-center gap-3 text-center">
        <LogoMark size={56} />
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
        <p className="max-w-[32ch] text-soil">{t('subtitle')}</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-amber/15 px-4 py-3 text-sm font-medium">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('error')}
        </p>
      ) : null}
      <div className="card">
        <SignInForm next={safeNext} google={isGoogleConfigured} startTab={tab === 'up' ? 'up' : 'in'} />
      </div>
      <p className="text-center text-sm text-soil">{t('noEmail')}</p>
    </main>
  );
}

import { titled } from '@/lib/titles';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LogoMark } from '@/components/Logo';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { isGoogleConfigured } from '@/lib/auth/google';
import { getViewer } from '@/lib/auth/viewer';
import { safeNextPath } from '@/lib/http';
import { LegalLinks } from '@/components/LegalPage';
import { SignInForm } from './SignInForm';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return titled((await searchParams).tab === 'up' ? 'createAccount' : 'signIn')();
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; tab?: string }> }) {
  const t = await getTranslations('auth');
  const { next, error, tab } = await searchParams;
  const safeNext = safeNextPath(next);
  if (await getViewer()) redirect(safeNext);

  return (
    <main className="mx-auto w-full flex flex-col gap-6 px-4 pb-24 pt-6 lg:max-w-md lg:px-8 lg:pb-16 lg:pt-10">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <SignInForm
        next={safeNext}
        google={isGoogleConfigured}
        startTab={tab === 'up' ? 'up' : 'in'}
        logo={<LogoMark size={56} />}
        error={
          error ? (
            <p role="alert" className="rounded-xl bg-amber/15 px-4 py-3 text-sm font-medium">
              {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('error')}
            </p>
          ) : null
        }
      />
      <p className="text-center text-sm text-soil">{t('noEmail')}</p>
      <LegalLinks />
    </main>
  );
}

import { titled } from '@/lib/titles';
import { getTranslations } from 'next-intl/server';
import { LogoMark } from '@/components/Logo';

export const generateMetadata = titled('signIn', { robots: { index: false } });

// Landing page for one-time sign-in links. Nothing happens until the person taps the button.
export default async function LinkPage({ searchParams }: { searchParams: Promise<{ token?: string; next?: string }> }) {
  const t = await getTranslations('auth');
  const { token = '', next = '' } = await searchParams;
  return (
    <main className="mx-auto w-full flex flex-col items-center gap-5 px-4 pb-24 pt-16 text-center lg:max-w-md lg:px-8 lg:pb-16 lg:pt-10">
      <LogoMark size={56} />
      <h1 className="text-2xl font-extrabold">{t('linkTitle')}</h1>
      <p className="max-w-[32ch] text-soil">{t('linkBody')}</p>
      <form action="/auth/link/confirm" method="post" className="w-full max-w-sm">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn-primary w-full">
          {t('linkButton')}
        </button>
      </form>
    </main>
  );
}

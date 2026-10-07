import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

export const metadata = { title: 'My Farm' };

export default async function MyFarmPage() {
  const t = await getTranslations('myFarm');
  if (!isSupabaseConfigured) redirect('/sign-in?next=/my-farm');

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/sign-in?next=/my-farm');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, roles, county_code')
    .eq('id', data.user.id)
    .maybeSingle();
  const name = profile?.full_name || data.user.email || '';

  return (
    <main className="flex flex-col gap-5 px-4 pt-8">
      <header>
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
        <p className="mt-1 text-soil">{t('signedInAs', { name })}</p>
      </header>

      <section className="card flex flex-col gap-4">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-lime text-forest" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2c-4 0-7 3-7 6.8C5 14 12 21 12 21s7-7 7-12.2C19 5 16 2 12 2z" strokeLinejoin="round" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">{t('pinTitle')}</h2>
        <p className="text-soil">{t('pinBody')}</p>
      </section>

      <form action="/auth/sign-out" method="post">
        <button type="submit" className="btn-secondary">
          {t('signOut')}
        </button>
      </form>
    </main>
  );
}

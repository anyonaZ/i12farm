import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { COUNTY_FOCUS, listFarmCategories, listPilotCounties, listPilotSubCounties, listProducts } from '@/domains/reference/queries';
import type { Locale } from '@/i18n/config';
import { PinWizard } from './PinWizard';

export const metadata = { title: 'Pin your farm' };

export default async function NewFarmPage() {
  if (!isSupabaseConfigured) redirect('/sign-in?next=/my-farm/new');
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/sign-in?next=/my-farm/new');

  const locale = (await getLocale()) as Locale;
  const [{ data: profile }, categories, products, counties, subCounties] = await Promise.all([
    supabase.from('profiles').select('full_name, roles').eq('id', data.user.id).maybeSingle(),
    listFarmCategories(locale),
    listProducts(locale),
    listPilotCounties(),
    listPilotSubCounties(),
  ]);

  return (
    <PinWizard
      isAgent={(profile?.roles ?? []).includes('agent')}
      defaultFarmer={profile?.full_name ?? ''}
      categories={(categories ?? []).map((c) => ({ slug: c.slug, name: c.name }))}
      products={products}
      counties={(counties ?? []).map((c) => ({ ...c, focus: COUNTY_FOCUS[c.code] ?? null }))}
      subCounties={subCounties}
    />
  );
}

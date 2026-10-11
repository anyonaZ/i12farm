import { getLocale } from 'next-intl/server';
import { requireViewer } from '@/lib/auth/viewer';
import { COUNTY_FOCUS, listFarmCategories, listPilotCounties, listPilotSubCounties, listProducts } from '@/domains/reference/queries';
import type { Locale } from '@/i18n/config';
import { PinWizard } from './PinWizard';

export const metadata = { title: 'Pin your farm' };

export default async function NewFarmPage() {
  const viewer = await requireViewer('/my-farm/new');
  const locale = (await getLocale()) as Locale;
  const [categories, products, counties, subCounties] = await Promise.all([
    listFarmCategories(locale),
    listProducts(locale),
    listPilotCounties(),
    listPilotSubCounties(),
  ]);

  return (
    <PinWizard
      isAgent={viewer.roles.includes('agent')}
      defaultFarmer={viewer.fullName ?? ''}
      categories={(categories ?? []).map((c) => ({ slug: c.slug, name: c.name }))}
      products={products}
      counties={(counties ?? []).map((c) => ({ ...c, focus: COUNTY_FOCUS[c.code] ?? null }))}
      subCounties={subCounties}
    />
  );
}

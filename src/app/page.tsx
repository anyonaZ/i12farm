import { getLocale } from 'next-intl/server';
import { ExploreClient } from '@/components/explore/ExploreClient';
import { COUNTY_FOCUS, listFarmCategories, listPilotCounties } from '@/domains/reference/queries';
import { isSupabaseConfigured } from '@/lib/env';
import type { Locale } from '@/i18n/config';

// Explore: full-screen map of published farms, search, category chips and a
// bottom sheet of the farms in view.
export default async function ExplorePage() {
  const locale = (await getLocale()) as Locale;
  const [categories, pilots] = await Promise.all([listFarmCategories(locale), listPilotCounties()]);

  if (!isSupabaseConfigured) {
    return (
      <main className="px-4 pb-24 pt-10">
        <h1 className="text-2xl font-extrabold">i12farm</h1>
        <p className="mt-2 text-soil">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (see README).</p>
      </main>
    );
  }

  return (
    <main>
      <h1 className="sr-only">i12farm</h1>
      <ExploreClient
        categories={(categories ?? []).map((c) => ({ slug: c.slug, name: c.name }))}
        counties={(pilots ?? []).map((c) => ({ ...c, focus: COUNTY_FOCUS[c.code] ?? null }))}
      />
    </main>
  );
}

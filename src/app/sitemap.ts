import type { MetadataRoute } from 'next';
import { isDbConfigured, withUser } from '@/lib/db';
import { siteUrl } from '@/lib/env';

// Every published farm, so search engines find farm pages (people search "pig farm Lang'ata").
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/vets`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${siteUrl}/prices`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${siteUrl}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${siteUrl}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ];
  if (!isDbConfigured) return fixed;
  const farms = await withUser(
    null,
    (tx) => tx<{ slug: string; updated_at: Date }[]>`
    select slug, updated_at from public.farms where status = 'published' order by updated_at desc limit 45000`,
  ).catch(() => []);
  return [
    ...fixed,
    ...farms.map((f) => ({ url: `${siteUrl}/f/${f.slug}`, lastModified: f.updated_at, changeFrequency: 'weekly' as const, priority: 0.8 })),
  ];
}

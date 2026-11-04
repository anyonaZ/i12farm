import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/my-farm', '/orders', '/inbox', '/account', '/admin', '/partner', '/checkout', '/sign-in', '/auth', '/api'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

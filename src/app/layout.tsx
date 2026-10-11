import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { BottomNav } from '@/components/BottomNav';
import { AppRuntime } from '@/components/AppRuntime';
import { siteUrl } from '@/lib/env';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    metadataBase: new URL(siteUrl),
    title: { default: `i12farm · ${t('tagline')}`, template: '%s · i12farm' },
    description: t('tagline'),
    applicationName: 'i12farm',
    appleWebApp: { capable: true, title: 'i12farm', statusBarStyle: 'default' },
    icons: {
      icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    },
    openGraph: { siteName: 'i12farm', type: 'website' },
  };
}

export const viewport: Viewport = {
  themeColor: '#053B2B',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={jakarta.variable}>
      <body className="antialiased">
        <NextIntlClientProvider>
          <div className="mx-auto min-h-dvh max-w-md">{children}</div>
          <BottomNav />
          <AppRuntime />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

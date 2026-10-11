import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { BottomNav } from '@/components/BottomNav';
import { AppRuntime } from '@/components/AppRuntime';
import { siteUrl } from '@/lib/env';
import './globals.css';

// Self-hosted (SIL OFL, see fonts/OFL.txt): no build-time call to Google Fonts,
// and the font is cached with the app shell for offline use.
const jakarta = localFont({
  src: './fonts/PlusJakartaSans-latin.woff2',
  weight: '200 800',
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

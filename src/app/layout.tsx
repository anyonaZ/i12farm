import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { BottomNav } from '@/components/BottomNav';
import { AppRuntime } from '@/components/AppRuntime';
import { FieldErrors } from '@/components/FieldErrors';
import { TopNav } from '@/components/TopNav';
import { displayName, getViewer } from '@/lib/auth/viewer';
import { publicDemo } from '@/lib/demo';
import { siteUrl } from '@/lib/env';
import './globals.css';

// Self-hosted (SIL OFL, see fonts/OFL.txt): no build-time call to Google Fonts,
// and the fonts are cached with the app shell for offline use.
// Inter for text, Outfit for headings and big numbers.
const inter = localFont({
  src: './fonts/Inter-latin.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});
const outfit = localFont({
  src: './fonts/Outfit-latin.woff2',
  weight: '100 900',
  variable: '--font-outfit',
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
  // Browser bar colour follows the phone's light or dark setting.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1410' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const viewer = await getViewer().catch(() => null);
  const tApp = await getTranslations('app');
  return (
    <html lang={locale} className={`${inter.variable} ${outfit.variable}`}>
      <body className="antialiased">
        <NextIntlClientProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-4 focus:py-3 focus:font-bold focus:text-white"
          >
            {tApp('skip')}
          </a>
          {publicDemo ? (
            <p className="bg-amber px-4 py-1.5 text-center text-xs font-bold text-ink" role="note">
              {tApp('demoBanner')}
            </p>
          ) : null}
          <TopNav
            viewer={
              viewer
                ? {
                    name: displayName(viewer),
                    admin: viewer.roles.includes('admin'),
                    partner: viewer.roles.includes('partner') || viewer.roles.includes('admin'),
                  }
                : null
            }
          />
          {/* Phones: one centred column. Desktop: each page sets its own width. */}
          <div id="main" tabIndex={-1} className="mx-auto min-h-dvh max-w-md outline-none lg:min-h-[calc(100dvh-4rem)] lg:max-w-none">
            {children}
          </div>
          <BottomNav />
          <AppRuntime />
          <FieldErrors />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

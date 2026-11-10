'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Logo } from '@/components/Logo';
import { Badge, useNavCounts } from '@/components/use-nav-counts';

// Laptop and desktop navigation (the bottom tab bar is for phones). From 1024 to
// 1279 px the items show icons only (names in a tooltip and for screen readers).
const ITEMS: { href: string; key: 'explore' | 'orders' | 'vets' | 'prices' | 'inbox' | 'myFarm'; icon: IconName }[] = [
  { href: '/', key: 'explore', icon: 'compass' },
  { href: '/orders', key: 'orders', icon: 'bag' },
  { href: '/vets', key: 'vets', icon: 'cross' },
  { href: '/prices', key: 'prices', icon: 'trend' },
  { href: '/inbox', key: 'inbox', icon: 'inbox' },
  { href: '/my-farm', key: 'myFarm', icon: 'sprout' },
];

export function TopNav({ viewer }: { viewer: { name: string; admin: boolean; partner: boolean } | null }) {
  const pathname = usePathname();
  const t = useTranslations();
  const counts = useNavCounts();

  return (
    <header className="sticky top-0 z-40 hidden h-16 border-b border-line bg-surface/95 backdrop-blur lg:block">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-6 xl:gap-6">
        <Link href="/" aria-label="i12farm" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label={t('nav.mainLabel')} className="flex flex-1 items-center gap-1">
          {ITEMS.map(({ href, key, icon }) => {
            const active = href === '/' ? pathname === '/' || pathname.startsWith('/f/') : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={t(`nav.${key}`)}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold xl:gap-2 xl:px-3.5 ${
                  active ? 'bg-sprout/15 text-sprout-deep' : 'text-soil hover:bg-mint hover:text-forest'
                }`}
              >
                <span className="relative">
                  <Icon name={icon} size={18} />
                  <Badge n={counts[key as keyof typeof counts]} label={t('nav.badge', { n: counts[key as keyof typeof counts] ?? 0 })} />
                </span>
                <span className="sr-only xl:not-sr-only">{t(`nav.${key}`)}</span>
              </Link>
            );
          })}
          {viewer?.partner ? (
            <Link
              href="/partner"
              title={t('nav.partner')}
              aria-current={pathname.startsWith('/partner') ? 'page' : undefined}
              className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold xl:gap-2 xl:px-3.5 ${
                pathname.startsWith('/partner') ? 'bg-sprout/15 text-sprout-deep' : 'text-soil hover:bg-mint hover:text-forest'
              }`}
            >
              <Icon name="chart" size={18} />
              <span className="sr-only xl:not-sr-only">{t('nav.partner')}</span>
            </Link>
          ) : null}
          {viewer?.admin ? (
            <Link
              href="/admin"
              title={t('myFarmPlus.admin')}
              aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
              className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold xl:gap-2 xl:px-3.5 ${
                pathname.startsWith('/admin') ? 'bg-sprout/15 text-sprout-deep' : 'text-soil hover:bg-mint hover:text-forest'
              }`}
            >
              <Icon name="shield" size={18} />
              <span className="sr-only xl:not-sr-only">{t('myFarmPlus.admin')}</span>
            </Link>
          ) : null}
        </nav>
        <Link
          href="/my-farm/new"
          className="hidden h-10 items-center gap-2 whitespace-nowrap rounded-full border border-line px-4 text-sm font-semibold text-forest hover:bg-mint 2xl:inline-flex"
        >
          <Icon name="pin" size={18} />
          {t('wizard.pinTitle')}
        </Link>
        <LanguageSwitch inNav />
        {viewer ? (
          <Link href="/account" className="inline-flex h-10 max-w-48 items-center gap-2 rounded-full bg-mint px-3 text-sm font-semibold">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-forest text-xs font-bold text-lime">
              {viewer.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className="hidden truncate xl:inline">{viewer.name}</span>
          </Link>
        ) : (
          <Link href="/sign-in" className="btn-primary h-10 min-h-10 w-auto px-5 text-sm">
            {t('auth.signInButton')}
          </Link>
        )}
      </div>
    </header>
  );
}

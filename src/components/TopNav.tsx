'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Logo } from '@/components/Logo';

// Laptop and desktop navigation (the bottom tab bar is for phones).
const ITEMS: { href: string; key: 'explore' | 'orders' | 'inbox' | 'myFarm'; icon: IconName }[] = [
  { href: '/', key: 'explore', icon: 'compass' },
  { href: '/orders', key: 'orders', icon: 'bag' },
  { href: '/inbox', key: 'inbox', icon: 'inbox' },
  { href: '/my-farm', key: 'myFarm', icon: 'sprout' },
];

export function TopNav({ viewer }: { viewer: { name: string; admin: boolean } | null }) {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <header className="sticky top-0 z-40 hidden h-16 border-b border-line bg-surface/95 backdrop-blur lg:block">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-8 px-6">
        <Link href="/" aria-label="i12farm" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex flex-1 items-center gap-1">
          {ITEMS.map(({ href, key, icon }) => {
            const active = href === '/' ? pathname === '/' || pathname.startsWith('/f/') : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${
                  active ? 'bg-sprout/15 text-sprout-deep' : 'text-soil hover:bg-mint hover:text-forest'
                }`}
              >
                <Icon name={icon} size={18} />
                {t(`nav.${key}`)}
              </Link>
            );
          })}
          {viewer?.admin ? (
            <Link
              href="/admin"
              aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
              className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${
                pathname.startsWith('/admin') ? 'bg-sprout/15 text-sprout-deep' : 'text-soil hover:bg-mint hover:text-forest'
              }`}
            >
              <Icon name="shield" size={18} />
              {t('myFarmPlus.admin')}
            </Link>
          ) : null}
        </nav>
        <Link
          href="/my-farm/new"
          className="hidden h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-forest hover:bg-mint xl:inline-flex"
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
            <span className="truncate">{viewer.name}</span>
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

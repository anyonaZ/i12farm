'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

// Market and Requests join this bar when Phases 2 and 3 ship.
const ITEMS = [
  { href: '/', key: 'explore', icon: CompassIcon },
  { href: '/inbox', key: 'inbox', icon: InboxIcon },
  { href: '/my-farm', key: 'myFarm', icon: SproutIcon },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md justify-around">
        {ITEMS.map(({ href, key, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${
                  active ? 'text-sprout-deep' : 'text-soil'
                }`}
              >
                <span className={`rounded-full px-4 py-1 ${active ? 'bg-sprout/15' : ''}`}>
                  <Icon />
                </span>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function CompassIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 5h16v14H4z" strokeLinejoin="round" />
      <path d="M4 13h5l1.5 2.5h3L15 13h5" strokeLinejoin="round" />
    </svg>
  );
}

function SproutIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 21v-9" strokeLinecap="round" />
      <path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 14c0-3.4-2.5-5.5-6-5.5 0 3.4 2.6 5.5 6 5.5z" strokeLinejoin="round" />
    </svg>
  );
}

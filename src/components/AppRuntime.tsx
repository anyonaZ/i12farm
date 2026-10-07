'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { track } from '@/lib/analytics/track';

// Registers the service worker and records page views and install events.
export function AppRuntime() {
  const pathname = usePathname();

  useEffect(() => {
    track('page.view', { standalone: window.matchMedia('(display-mode: standalone)').matches });
  }, [pathname]);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
    const onPrompt = () => track('app.install_prompted');
    const onInstalled = () => track('app.installed');
    const onOffline = () => track('app.offline');
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return null;
}

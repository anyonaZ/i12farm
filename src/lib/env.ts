// Public settings, safe to import from client components.
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.4.0';

import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from './config';

// Locale lives in a cookie rather than the URL: farm links shared on WhatsApp
// stay short and identical in both languages.
export default getRequestConfig(async () => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale: Locale = defaultLocale;
  if (isLocale(saved)) {
    locale = saved;
  } else {
    const accept = (await headers()).get('accept-language') ?? '';
    if (/(^|,)\s*sw\b/i.test(accept)) locale = 'sw';
  }
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

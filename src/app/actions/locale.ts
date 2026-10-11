'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';
import { isLocale, LOCALE_COOKIE } from '@/i18n/config';

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  // Remember the choice on the profile too, so SMS and USSD use it later.
  const viewer = await getViewer();
  if (viewer) {
    await withUser(viewer.id, (tx) => tx`update public.profiles set preferred_language = ${locale} where id = ${viewer.id}`);
  }
  revalidatePath('/', 'layout');
}

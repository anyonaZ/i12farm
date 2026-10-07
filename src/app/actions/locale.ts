'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isLocale, LOCALE_COOKIE } from '@/i18n/config';

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  // Remember the choice on the profile too, so SMS and USSD use it later.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    await supabase.from('profiles').update({ preferred_language: locale }).eq('id', data.user.id);
  }
  revalidatePath('/', 'layout');
}

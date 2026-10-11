import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getSql } from '@/lib/db';
import { getSession } from './session';

export type Role = 'farmer' | 'buyer' | 'provider' | 'agent' | 'partner' | 'admin';

export interface Viewer {
  id: string;
  sessionId: string;
  fullName: string | null;
  email: string | null;
  emailVerified: boolean;
  phone: string | null; // sign-in phone, 2547XXXXXXXX
  contactPhone: string | null; // profile phone, +2547XXXXXXXX
  roles: Role[];
  countyCode: number | null;
  preferredLanguage: 'en' | 'sw';
  hasPassword: boolean;
  hasGoogle: boolean;
}

/** The signed-in person, or null. Cached for one request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await getSession();
  if (!session) return null;
  const [row] = await getSql()<
    {
      full_name: string | null;
      email: string | null;
      email_verified: boolean;
      phone: string | null;
      contact_phone: string | null;
      roles: Role[];
      county_code: number | null;
      preferred_language: 'en' | 'sw';
      has_password: boolean;
      has_google: boolean;
    }[]
  >`
    select p.full_name, u.email, u.email_verified_at is not null as email_verified, u.phone,
           p.phone as contact_phone, p.roles::text[] as roles, p.county_code, p.preferred_language,
           u.password_hash is not null as has_password,
           exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google') as has_google
    from auth.users u join public.profiles p on p.id = u.id
    where u.id = ${session.userId}`;
  if (!row) return null;
  return {
    id: session.userId,
    sessionId: session.id,
    fullName: row.full_name,
    email: row.email,
    emailVerified: row.email_verified,
    phone: row.phone,
    contactPhone: row.contact_phone,
    roles: row.roles,
    countyCode: row.county_code,
    preferredLanguage: row.preferred_language,
    hasPassword: row.has_password,
    hasGoogle: row.has_google,
  };
});

export async function requireViewer(next: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return viewer;
}

export async function requireRole(role: Role, next: string): Promise<Viewer> {
  const viewer = await requireViewer(next);
  if (!viewer.roles.includes(role)) redirect('/my-farm');
  return viewer;
}

export function displayName(v: Pick<Viewer, 'fullName' | 'email' | 'phone'>): string {
  if (v.fullName) return v.fullName;
  if (v.email) return v.email;
  if (v.phone) return '0' + v.phone.slice(3);
  return '';
}

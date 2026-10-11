'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import {
  audit,
  checkPassword,
  createAccount,
  createSignInLink,
  normaliseEmail,
  parseIdentifier,
  setPassword,
  signInWithPassword,
  userForEmailLink,
} from '@/lib/auth/accounts';
import { passwordProblem } from '@/lib/auth/password';
import { requestInfo, revokeOtherSessions, startSession } from '@/lib/auth/session';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, getSql, withUser } from '@/lib/db';
import { isMailConfigured, sendMail } from '@/lib/mail';
import { normalisePhone, toInternational } from '@/lib/phone';

const CONSENT_VERSION = '2026-10'; // bump when the terms or privacy notice change

export type FormState = {
  error?: string; // key under auth.errors
  detail?: string; // extra text (e.g. database message)
  done?: boolean;
  devLink?: string;
  values?: Record<string, string>;
};

function safeNext(raw: FormDataEntryValue | null): string {
  const next = typeof raw === 'string' ? raw : '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/my-farm';
}

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

// ---------------------------------------------------------------------------
// Sign in / sign up
// ---------------------------------------------------------------------------
export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const identifier = parseIdentifier(str(form, 'identifier'));
  const password = String(form.get('password') ?? '');
  const values = { identifier: str(form, 'identifier') };
  if (!identifier || !password) return { error: 'missing', values };

  const { ip } = await requestInfo();
  const result = await signInWithPassword(identifier, password, ip);
  if (!result.ok) return { error: result.error, values };

  await startSession(result.userId, 'password');
  await withUser(result.userId, (tx) =>
    recordEvent(tx, {
      name: 'auth.signed_in',
      userId: result.userId,
      properties: { provider: 'password', with: identifier.kind },
      path: '/sign-in',
    }),
  );
  redirect(safeNext(form.get('next')));
}

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const fullName = str(form, 'full_name').slice(0, 120);
  const phone = toInternational(str(form, 'phone'));
  const rawEmail = str(form, 'email');
  const email = rawEmail ? normaliseEmail(rawEmail) : null;
  const password = String(form.get('password') ?? '');
  const values = { full_name: fullName, phone: str(form, 'phone'), email: rawEmail };

  if (fullName.length < 2) return { error: 'nameMissing', values };
  if (!phone) return { error: 'phoneInvalid', values };
  if (rawEmail && !email) return { error: 'emailInvalid', values };
  const weak = passwordProblem(password);
  if (weak) return { error: weak, values };
  if (form.get('consent') !== 'on') return { error: 'consent', values };

  const locale = (await getLocale()) === 'sw' ? 'sw' : 'en';
  const created = await createAccount({ fullName, phone, email, password, locale, consentVersion: CONSENT_VERSION });
  if (!created.ok) return { error: created.error, values };

  await startSession(created.userId, 'sign_up');
  await withUser(created.userId, (tx) =>
    recordEvent(tx, { name: 'auth.signed_up', userId: created.userId, properties: { with_email: Boolean(email) }, path: '/sign-in' }),
  );
  redirect(safeNext(form.get('next')));
}

export async function requestEmailLink(_prev: FormState, form: FormData): Promise<FormState> {
  const email = normaliseEmail(str(form, 'email'));
  if (!email) return { error: 'emailInvalid', values: { email: str(form, 'email') } };
  const { ip } = await requestInfo();
  const locale = (await getLocale()) === 'sw' ? 'sw' : 'en';
  const userId = await userForEmailLink(email, ip, locale);
  // Same answer whether or not we sent, so the form can't be used to probe accounts.
  if (!userId) return { done: true };

  const link = await createSignInLink(userId, 'email_link', null);
  const next = safeNext(form.get('next'));
  const url = next === '/my-farm' ? link : `${link}&next=${encodeURIComponent(next)}`;
  const sent = await sendMail({
    to: email,
    subject: locale === 'sw' ? 'Kiungo chako cha kuingia i12farm' : 'Your i12farm sign-in link',
    text:
      locale === 'sw'
        ? `Bonyeza kiungo hiki kuingia i12farm. Kinafanya kazi mara moja tu, kwa saa moja.\n\n${url}\n\nKama hukuomba, puuza ujumbe huu.`
        : `Open this link to sign in to i12farm. It works once, for one hour.\n\n${url}\n\nIf you didn't ask for it, ignore this email.`,
  });
  // On a laptop without SMTP, show the link so sign-in can be tested.
  const devLink = !sent && !isMailConfigured && process.env.NODE_ENV !== 'production' ? url : undefined;
  return { done: true, devLink };
}

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------
export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { error: 'signedOut' };
  const fullName = str(form, 'full_name').slice(0, 120);
  const contact = str(form, 'contact_phone');
  const contactPhone = contact ? normalisePhone(contact) : null;
  const county = Number(form.get('county_code')) || null;
  if (fullName.length < 2) return { error: 'nameMissing' };
  if (contact && !contactPhone) return { error: 'phoneInvalid' };
  try {
    await withUser(
      viewer.id,
      (tx) =>
        tx`update public.profiles set full_name = ${fullName}, phone = ${contactPhone}, county_code = ${county} where id = ${viewer.id}`,
    );
  } catch (error) {
    return { error: 'saveFailed', detail: dbMessage(error) };
  }
  revalidatePath('/account');
  return { done: true };
}

/** Change the phone or email used to sign in. Needs the current password when one is set. */
export async function updateSignInDetails(_prev: FormState, form: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { error: 'signedOut' };
  const rawPhone = str(form, 'phone');
  const rawEmail = str(form, 'email');
  const phone = rawPhone ? toInternational(rawPhone) : null;
  const email = rawEmail ? normaliseEmail(rawEmail) : null;
  if (rawPhone && !phone) return { error: 'phoneInvalid' };
  if (rawEmail && !email) return { error: 'emailInvalid' };
  if (!phone && !email) return { error: 'needOneIdentifier' };
  if (viewer.hasPassword && !(await checkPassword(viewer.id, String(form.get('current_password') ?? '')))) {
    return { error: 'currentPasswordWrong' };
  }
  const sql = getSql();
  try {
    await sql`
      update auth.users
         set phone = ${phone},
             email = ${email},
             email_verified_at = case when email is not distinct from ${email} then email_verified_at end,
             phone_verified_at = case when phone is not distinct from ${phone} then phone_verified_at end
       where id = ${viewer.id}`;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'identifierTaken' };
    return { error: 'saveFailed', detail: dbMessage(error) };
  }
  await audit(viewer.id, viewer.id, 'sign_in_details.changed', { phone: Boolean(phone), email: Boolean(email) });
  revalidatePath('/account');
  return { done: true };
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { error: 'signedOut' };
  const next = String(form.get('new_password') ?? '');
  const weak = passwordProblem(next);
  if (weak) return { error: weak };
  if (viewer.hasPassword && !(await checkPassword(viewer.id, String(form.get('current_password') ?? '')))) {
    return { error: 'currentPasswordWrong' };
  }
  await setPassword(viewer.id, next);
  // Other phones signed in with the old password are signed out.
  await revokeOtherSessions(viewer.id, viewer.sessionId, 'password_changed');
  await audit(viewer.id, viewer.id, 'password.changed');
  revalidatePath('/account');
  return { done: true };
}

export async function signOutOtherDevices(): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { error: 'signedOut' };
  await revokeOtherSessions(viewer.id, viewer.sessionId, 'signed_out_elsewhere');
  revalidatePath('/account');
  return { done: true };
}

// ---------------------------------------------------------------------------
// Claim a farm enrolled by a field agent
// ---------------------------------------------------------------------------
export async function claimFarm(_prev: FormState, form: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { error: 'signedOut' };
  const code = str(form, 'code').replace(/\D/g, '');
  if (code.length !== 8) return { error: 'claimCodeFormat', values: { code: str(form, 'code') } };
  try {
    const farm = await withUser(viewer.id, async (tx) => {
      const [row] = await tx<{ id: string; slug: string; name: string }[]>`select * from public.claim_farm(${code})`;
      if (row) await recordEvent(tx, { name: 'farm.claimed', userId: viewer.id, properties: { farm: row.id }, path: '/account' });
      return row;
    });
    if (!farm) return { error: 'claimCodeWrong', values: { code: str(form, 'code') } };
    revalidatePath('/my-farm');
    return { done: true, detail: farm.name };
  } catch (error) {
    return { error: 'claimFailed', detail: dbMessage(error) };
  }
}

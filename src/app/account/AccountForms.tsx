'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useTransition } from 'react';
import {
  changePassword,
  claimFarm,
  deleteMyAccount,
  signOutOtherDevices,
  updateProfile,
  updateSignInDetails,
  type FormState,
} from '@/domains/identity/actions';

const initial: FormState = {};

function Status({ state, okText }: { state: FormState; okText: string }) {
  const t = useTranslations('auth');
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2 text-sm font-semibold">
        {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t('error')}
        {state.detail && state.error !== 'claimCodeWrong' ? ` (${state.detail})` : ''}
      </p>
    );
  }
  if (state.done) {
    return (
      <p role="status" className="rounded-xl bg-sprout/10 px-3 py-2 text-sm font-semibold text-forest">
        {okText}
      </p>
    );
  }
  return null;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {children}
      {hint ? <span className="text-xs text-soil">{hint}</span> : null}
    </div>
  );
}

export function ProfileForm({
  fullName,
  contactPhone,
  countyCode,
  counties,
}: {
  fullName: string;
  contactPhone: string;
  countyCode: number | null;
  counties: { code: number; name: string }[];
}) {
  const t = useTranslations('account');
  const ta = useTranslations('auth');
  const [state, action, pending] = useActionState(updateProfile, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Status state={state} okText={t('saved')} />
      <Field id="p-name" label={ta('fullName')}>
        <input id="p-name" name="full_name" defaultValue={fullName} required maxLength={120} autoComplete="name" className="input" />
      </Field>
      <Field id="p-phone" label={t('contactPhone')} hint={t('contactPhoneHint')}>
        <input id="p-phone" name="contact_phone" type="tel" inputMode="tel" defaultValue={contactPhone} className="input tabular-nums" />
      </Field>
      <Field id="p-county" label={t('county')}>
        <select id="p-county" name="county_code" defaultValue={countyCode ?? ''} className="input">
          <option value="">{t('noCounty')}</option>
          {counties.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <button type="submit" disabled={pending} className="btn-secondary">
        {t('save')}
      </button>
    </form>
  );
}

export function SignInDetailsForm({
  phone,
  email,
  emailVerified,
  hasPassword,
}: {
  phone: string;
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
}) {
  const t = useTranslations('account');
  const ta = useTranslations('auth');
  const [state, action, pending] = useActionState(updateSignInDetails, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-soil">{t('signInHint')}</p>
      <Status state={state} okText={t('saved')} />
      <Field id="s-phone" label={ta('phone')}>
        <input
          id="s-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={phone}
          autoComplete="tel"
          className="input tabular-nums"
        />
      </Field>
      <Field id="s-email" label={`${ta('emailLabel')}${email ? ` · ${emailVerified ? t('verified') : t('unverified')}` : ''}`}>
        <input id="s-email" name="email" type="email" inputMode="email" defaultValue={email} autoComplete="email" className="input" />
      </Field>
      {hasPassword ? (
        <Field id="s-current" label={t('currentPassword')}>
          <input id="s-current" name="current_password" type="password" autoComplete="current-password" required className="input" />
        </Field>
      ) : null}
      <button type="submit" disabled={pending} className="btn-secondary">
        {t('save')}
      </button>
    </form>
  );
}

export function PasswordForm({ hasPassword, prompt }: { hasPassword: boolean; prompt: boolean }) {
  const t = useTranslations('account');
  const ta = useTranslations('auth');
  const [state, action, pending] = useActionState(changePassword, initial);
  return (
    <form action={action} className="flex flex-col gap-3" id="password">
      {prompt && !state.done ? <p className="rounded-xl bg-lime/40 px-3 py-2 text-sm font-semibold">{t('setPasswordPrompt')}</p> : null}
      <Status state={state} okText={t('passwordChanged')} />
      {hasPassword && !prompt ? (
        <Field id="pw-current" label={t('currentPassword')}>
          <input id="pw-current" name="current_password" type="password" autoComplete="current-password" required className="input" />
        </Field>
      ) : null}
      <Field id="pw-new" label={t('newPassword')} hint={ta('passwordHint')}>
        <input id="pw-new" name="new_password" type="password" autoComplete="new-password" required minLength={8} className="input" />
      </Field>
      <button type="submit" disabled={pending} className="btn-primary">
        {hasPassword ? t('changePassword') : t('setPassword')}
      </button>
    </form>
  );
}

export function SignOutOthersButton() {
  const t = useTranslations('account');
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="btn-secondary"
      onClick={() => start(async () => void (await signOutOtherDevices()))}
    >
      {t('signOutOthers')}
    </button>
  );
}

export function ClaimForm() {
  const t = useTranslations('account');
  const [state, action, pending] = useActionState(claimFarm, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-soil">{t('claimHint')}</p>
      <Status state={state} okText={t('claimed', { farm: state.detail ?? '' })} />
      <Field id="c-code" label={t('claimCode')}>
        <input
          id="c-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="1234 5678"
          maxLength={12}
          defaultValue={state.values?.code}
          className="input text-center font-mono text-lg tracking-[0.2em] tabular-nums"
        />
      </Field>
      <button type="submit" disabled={pending} className="btn-primary">
        {t('claimButton')}
      </button>
    </form>
  );
}

/** Download my data + Delete my account. Deleting asks for a typed word so a stray tap cannot do it. */
export function DataControls() {
  const t = useTranslations('account');
  const [state, action, pending] = useActionState(deleteMyAccount, initial);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-soil">{t('downloadHint')}</p>
        <a href="/account/export" className="btn-secondary" download>
          {t('download')}
        </a>
      </div>
      <details className="rounded-2xl border border-line p-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-bold text-forest">{t('deleteTitle')}</summary>
        <form action={action} className="mt-2 flex flex-col gap-3">
          <p className="text-sm">{t('deleteHint')}</p>
          <Status state={state} okText="" />
          <Field id="del-phrase" label={t('deletePhrase')}>
            <input id="del-phrase" name="phrase" autoComplete="off" autoCapitalize="characters" className="input" />
          </Field>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-tap w-full items-center justify-center rounded-full bg-red-700 px-5 font-semibold text-white disabled:opacity-60"
          >
            {t('deleteButton')}
          </button>
        </form>
      </details>
    </div>
  );
}

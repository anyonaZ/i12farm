'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { requestEmailLink, signIn, signUp, type FormState } from '@/domains/identity/actions';
import { track } from '@/lib/analytics/track';

const initial: FormState = {};

export function SignInForm({
  next,
  google,
  startTab,
  logo,
  error,
}: {
  next: string;
  google: boolean;
  startTab: 'in' | 'up';
  logo: React.ReactNode;
  error: React.ReactNode;
}) {
  const t = useTranslations('auth');
  const tt = useTranslations('titles');
  const [tab, setTabState] = useState<'in' | 'up'>(startTab);
  const [forgot, setForgot] = useState(false);

  // The heading, browser tab title and link follow the chosen tab, so a
  // refresh or a shared link opens the same one.
  function setTab(next: 'in' | 'up') {
    setTabState(next);
    document.title = `${tt(next === 'up' ? 'createAccount' : 'signIn')} · i12farm`;
    const url = new URL(window.location.href);
    if (next === 'up') url.searchParams.set('tab', 'up');
    else url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url);
  }

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        {logo}
        <h1 className="text-2xl font-extrabold">{tab === 'up' ? t('titleUp') : t('title')}</h1>
        <p className="max-w-[32ch] text-soil">{tab === 'up' ? t('subtitleUp') : t('subtitle')}</p>
      </div>
      {error}
      <div className="card">
        <div className="flex flex-col gap-5">
          <div role="tablist" aria-label={t('title')} className="grid grid-cols-2 rounded-full bg-mint p-1">
            {(['in', 'up'] as const).map((key) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-11 rounded-full text-sm font-bold ${tab === key ? 'bg-surface text-forest shadow-sm' : 'text-soil'}`}
              >
                {key === 'in' ? t('tabSignIn') : t('tabSignUp')}
              </button>
            ))}
          </div>

          {tab === 'in' ? <PasswordSignIn next={next} /> : <CreateAccount next={next} />}

          {google ? (
            <>
              <div className="flex items-center gap-3 text-sm text-soil" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                {t('or')}
                <span className="h-px flex-1 bg-line" />
              </div>
              <a
                href={`/auth/google?next=${encodeURIComponent(next)}`}
                onClick={() => track('auth.sign_in_started', { method: 'google' })}
                className="btn-secondary"
              >
                <GoogleG />
                {t('google')}
              </a>
            </>
          ) : null}

          {tab === 'in' ? (
            <div className="border-t border-line pt-4">
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm font-bold text-sprout-deep"
                aria-expanded={forgot}
                onClick={() => setForgot((f) => !f)}
              >
                {t('forgot')}
              </button>
              {forgot ? (
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-sm text-soil">{t('forgotBody')}</p>
                  <EmailLink next={next} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ErrorLine({ state }: { state: FormState }) {
  const t = useTranslations('auth');
  if (!state.error) return null;
  return (
    <p role="alert" className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
      {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t('error')}
    </p>
  );
}

function PasswordInput({
  id,
  name,
  autoComplete,
  label,
  hint,
}: {
  id: string;
  name: string;
  autoComplete: string;
  label: string;
  hint?: string;
}) {
  const t = useTranslations('auth');
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={name === 'password' && autoComplete === 'current-password' ? 1 : 8}
          className="input pr-20"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-1 my-auto h-10 rounded-full px-3 text-sm font-bold text-sprout-deep"
          aria-pressed={show}
        >
          {show ? t('hide') : t('show')}
        </button>
      </div>
      {hint ? <span className="text-xs text-soil">{hint}</span> : null}
    </div>
  );
}

function PasswordSignIn({ next }: { next: string }) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="flex flex-col gap-3.5" onSubmit={() => track('auth.sign_in_started', { method: 'password' })}>
      <input type="hidden" name="next" value={next} />
      <ErrorLine state={state} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="si-id" className="text-sm font-bold">
          {t('identifier')}
        </label>
        <input
          id="si-id"
          name="identifier"
          required
          autoComplete="username"
          inputMode="email"
          defaultValue={state.values?.identifier}
          placeholder={t('identifierHint')}
          className="input"
        />
      </div>
      <PasswordInput id="si-pw" name="password" autoComplete="current-password" label={t('password')} />
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? t('signingIn') : t('signInButton')}
      </button>
    </form>
  );
}

function CreateAccount({ next }: { next: string }) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(signUp, initial);
  return (
    <form action={action} className="flex flex-col gap-3.5" onSubmit={() => track('auth.sign_in_started', { method: 'sign_up' })}>
      <input type="hidden" name="next" value={next} />
      {/* Left empty by people; bots fill it in. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px opacity-0"
      />
      <ErrorLine state={state} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="su-name" className="text-sm font-bold">
          {t('fullName')}
        </label>
        <input
          id="su-name"
          name="full_name"
          required
          autoComplete="name"
          maxLength={120}
          defaultValue={state.values?.full_name}
          className="input"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="su-phone" className="text-sm font-bold">
          {t('phone')}
        </label>
        <input
          id="su-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          required
          autoComplete="tel"
          placeholder="0712 345 678"
          defaultValue={state.values?.phone}
          className="input tabular-nums"
        />
        <span className="text-xs text-soil">{t('phoneHint')}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="su-email" className="text-sm font-bold">
          {t('emailOptional')}
        </label>
        <input
          id="su-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={state.values?.email}
          className="input"
        />
        <span className="text-xs text-soil">{t('emailOptionalHint')}</span>
      </div>
      <PasswordInput id="su-pw" name="password" autoComplete="new-password" label={t('password')} hint={t('passwordHint')} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-5 shrink-0 accent-sprout-deep" />
        <span>
          {t('consent')}{' '}
          <a href="/privacy" target="_blank" rel="noopener" className="font-semibold text-sprout-deep underline">
            {t('consentLinks')}
          </a>
        </span>
      </label>
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? t('creating') : t('signUpButton')}
      </button>
    </form>
  );
}

function EmailLink({ next }: { next: string }) {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(requestEmailLink, initial);
  if (state.done) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl bg-sprout/10 px-4 py-3 text-sm font-medium text-forest">
        <p>{t('emailSent')}</p>
        {state.devLink ? (
          <p>
            {t('emailDev')}{' '}
            <a href={state.devLink} className="break-all font-bold text-sprout-deep underline">
              {state.devLink}
            </a>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2.5" onSubmit={() => track('auth.sign_in_started', { method: 'email' })}>
      <input type="hidden" name="next" value={next} />
      <ErrorLine state={state} />
      <label htmlFor="el-email" className="text-sm font-bold">
        {t('emailLabel')}
      </label>
      <input
        id="el-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        className="input"
      />
      <button type="submit" disabled={pending} className="btn-secondary">
        {t('emailButton')}
      </button>
    </form>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

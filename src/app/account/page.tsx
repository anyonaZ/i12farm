import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { listMySessions } from '@/domains/identity/queries';
import { listCounties } from '@/domains/reference/queries';
import { requireViewer } from '@/lib/auth/viewer';
import { displayPhone } from '@/lib/phone';
import { ClaimForm, PasswordForm, ProfileForm, SignInDetailsForm, SignOutOthersButton } from './AccountForms';

export const metadata = { title: 'Account', robots: { index: false } };

function device(ua: string | null): string {
  if (!ua) return '—';
  const os = /android/i.test(ua)
    ? 'Android'
    : /iphone|ipad/i.test(ua)
      ? 'iPhone'
      : /windows/i.test(ua)
        ? 'Windows'
        : /mac os/i.test(ua)
          ? 'Mac'
          : /linux/i.test(ua)
            ? 'Linux'
            : '';
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\//i.test(ua)
      ? 'Opera'
      : /firefox/i.test(ua)
        ? 'Firefox'
        : /chrome/i.test(ua)
          ? 'Chrome'
          : /safari/i.test(ua)
            ? 'Safari'
            : '';
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const viewer = await requireViewer('/account');
  const t = await getTranslations('account');
  const format = await getFormatter();
  const [{ set }, sessions, counties] = await Promise.all([searchParams, listMySessions(viewer), listCounties()]);

  return (
    <main className="mx-auto w-full flex flex-col gap-5 px-4 pb-24 pt-6 lg:max-w-2xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-center justify-between gap-3">
        <Link href="/my-farm" className="grid size-11 place-items-center rounded-full border border-line bg-surface" aria-label="Back">
          <Icon name="back" />
        </Link>
        <h1 className="flex-1 text-2xl font-extrabold">{t('title')}</h1>
        <LanguageSwitch />
      </header>

      {set === 'password' ? (
        <section className="card gap-3 border-sprout">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Icon name="lock" className="text-sprout-deep" />
            {t('passwordTitle')}
          </h2>
          <PasswordForm hasPassword={viewer.hasPassword} prompt />
        </section>
      ) : null}

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('profile')}</h2>
        <ProfileForm
          fullName={viewer.fullName ?? ''}
          contactPhone={displayPhone(viewer.contactPhone)}
          countyCode={viewer.countyCode}
          counties={counties ?? []}
        />
        <div className="flex flex-wrap gap-1.5 pt-1" aria-label={t('roles')}>
          {viewer.roles.map((r) => (
            <span key={r} className="rounded-full bg-mint px-2.5 py-1 text-xs font-bold">
              {t(`roleNames.${r}`)}
            </span>
          ))}
          {viewer.hasGoogle ? <span className="rounded-full bg-mint px-2.5 py-1 text-xs font-bold">{t('googleLinked')}</span> : null}
        </div>
      </section>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('claimTitle')}</h2>
        <ClaimForm />
      </section>

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('signIn')}</h2>
        <SignInDetailsForm
          phone={viewer.phone ? displayPhone(viewer.phone) : ''}
          email={viewer.email ?? ''}
          emailVerified={viewer.emailVerified}
          hasPassword={viewer.hasPassword}
        />
      </section>

      {set !== 'password' ? (
        <section className="card gap-3">
          <h2 className="text-lg font-bold">{t('passwordTitle')}</h2>
          <PasswordForm hasPassword={viewer.hasPassword} prompt={false} />
        </section>
      ) : null}

      <section className="card gap-3">
        <h2 className="text-lg font-bold">{t('devices')}</h2>
        <ul className="flex flex-col">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-sm first:border-t-0">
              <span className="min-w-0">
                <b className="block truncate">{s.current ? t('thisDevice') : device(s.user_agent)}</b>
                <span className="text-soil">
                  {t(`methods.${s.method}`)} · {t('lastSeen', { when: format.relativeTime(s.last_seen_at) })}
                </span>
              </span>
              {s.current ? <Icon name="check" className="shrink-0 text-sprout-deep" /> : null}
            </li>
          ))}
        </ul>
        {sessions.length > 1 ? <SignOutOthersButton /> : null}
      </section>

      <form action="/auth/sign-out" method="post">
        <button type="submit" className="btn-secondary">
          {(await getTranslations('myFarm'))('signOut')}
        </button>
      </form>
    </main>
  );
}

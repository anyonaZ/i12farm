'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { issueSignInLink, recordPayout, recordRefund, setCommission, setRoles, setUserStatus, verifyFarm } from '@/domains/admin/actions';

const ROLES = ['farmer', 'buyer', 'agent', 'provider', 'partner', 'admin'] as const;

function useRun() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? t('done') : t('error', { reason: r.error ?? '' }));
      router.refresh();
    });
  return { pending, message, run };
}

export function UserRow({
  user,
  isSelf,
}: {
  user: {
    id: string;
    full_name: string | null;
    email: string | null;
    phoneDisplay: string | null;
    roles: string[];
    status: 'active' | 'suspended';
    farms: number;
    joined: string;
    lastSeen: string | null;
    has_password: boolean;
    has_google: boolean;
  };
  isSelf: boolean;
}) {
  const t = useTranslations('admin');
  const ta = useTranslations('account');
  const [roles, setLocalRoles] = useState<string[]>(user.roles);
  const [link, setLink] = useState('');
  const { pending, message, run } = useRun();
  const changed = roles.slice().sort().join() !== user.roles.slice().sort().join();

  return (
    <li className={`card gap-2.5 p-4 ${user.status === 'suspended' ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <b className="block truncate">{user.full_name || user.email || user.phoneDisplay}</b>
          <span className="block truncate text-sm text-soil">{[user.phoneDisplay, user.email].filter(Boolean).join(' · ')}</span>
          <span className="block text-xs text-soil">
            {t('joined', { when: user.joined })} · {t('lastSeen', { when: user.lastSeen ?? t('never') })} ·{' '}
            {t('farmsCount', { n: user.farms })}
          </span>
        </span>
        {user.status === 'suspended' ? (
          <span className="rounded-full bg-amber/25 px-2 py-0.5 text-xs font-bold">{t('suspended')}</span>
        ) : null}
      </div>
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">{t('roles')}</legend>
        {ROLES.map((r) => {
          const on = roles.includes(r);
          return (
            <label
              key={r}
              className={`chip min-h-9 cursor-pointer px-3 text-xs font-bold ${on ? 'border-forest bg-forest text-white' : ''}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                disabled={isSelf && r === 'admin'}
                onChange={() => setLocalRoles(on ? roles.filter((x) => x !== r) : [...roles, r])}
              />
              {ta(`roleNames.${r}`)}
            </label>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {changed ? (
          <button
            type="button"
            disabled={pending}
            className="btn-primary min-h-10 w-auto px-4 text-sm"
            onClick={() => run(() => setRoles(user.id, roles))}
          >
            {t('saveRoles')}
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          className="btn-secondary min-h-10 w-auto px-4 text-sm"
          onClick={() =>
            run(async () => {
              const r = await issueSignInLink(user.id);
              if (r.ok) setLink(r.data.link);
              return r;
            })
          }
        >
          <Icon name="lock" size={14} />
          {t('signInLink')}
        </button>
        {!isSelf ? (
          <button
            type="button"
            disabled={pending}
            className="btn-secondary min-h-10 w-auto px-4 text-sm"
            onClick={() => run(() => setUserStatus(user.id, user.status === 'active' ? 'suspended' : 'active'))}
          >
            {user.status === 'active' ? t('suspend') : t('activate')}
          </button>
        ) : null}
      </div>
      {link ? (
        <div className="flex flex-col gap-1 rounded-xl bg-mint p-3 text-xs">
          <span className="text-soil">{t('linkHint')}</span>
          <input readOnly value={link} className="input min-h-9 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-xs font-semibold text-soil">
          {message}
        </p>
      ) : null}
    </li>
  );
}

export function FarmVerifyButton({ farmId, verified }: { farmId: string; verified: boolean }) {
  const t = useTranslations('admin');
  const { pending, run } = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      className={`${verified ? 'btn-secondary' : 'btn-primary'} min-h-10 w-auto shrink-0 px-3.5 text-sm`}
      onClick={() => run(() => verifyFarm(farmId, !verified))}
    >
      {verified ? t('unverify') : t('verify')}
    </button>
  );
}

export function PayoutForm({ farmId, due }: { farmId: string; due: number }) {
  const t = useTranslations('admin');
  const [amount, setAmount] = useState(String(Math.round(due)));
  const [ref, setRef] = useState('');
  const { pending, message, run } = useRun();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <input
          aria-label="KES"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
          className="input min-h-10 tabular-nums"
        />
        <input
          aria-label={t('reference')}
          placeholder={t('reference')}
          value={ref}
          onChange={(e) => setRef(e.target.value.toUpperCase())}
          className="input min-h-10 font-mono"
        />
        <button
          type="button"
          disabled={pending || !ref}
          className="btn-primary col-span-2 min-h-10 text-sm"
          onClick={() => run(() => recordPayout(farmId, Number(amount), ref))}
        >
          {t('recordPayout')}
        </button>
      </div>
      {message ? <p className="text-xs font-semibold text-soil">{message}</p> : null}
    </div>
  );
}

export function RefundForm({ orderId }: { orderId: string }) {
  const t = useTranslations('admin');
  const [ref, setRef] = useState('');
  const { pending, message, run } = useRun();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          aria-label={t('reference')}
          placeholder={t('reference')}
          value={ref}
          onChange={(e) => setRef(e.target.value.toUpperCase())}
          className="input min-h-10 font-mono"
        />
        <button
          type="button"
          disabled={pending || !ref}
          className="btn-primary min-h-10 w-auto px-3 text-sm"
          onClick={() => run(() => recordRefund(orderId, ref))}
        >
          {t('recordRefund')}
        </button>
      </div>
      {message ? <p className="text-xs font-semibold text-soil">{message}</p> : null}
    </div>
  );
}

export function CommissionForm({ percent }: { percent: number }) {
  const t = useTranslations('admin');
  const [value, setValue] = useState(String(percent));
  const { pending, message, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="commission" className="text-lg font-bold">
        {t('commission')}
      </label>
      <p className="text-sm text-soil">{t('commissionHint')}</p>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          id="commission"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
          className="input tabular-nums"
        />
        <button
          type="button"
          disabled={pending}
          className="btn-primary w-auto px-5"
          onClick={() => run(() => setCommission(Number(value)))}
        >
          {t('save')}
        </button>
      </div>
      {message ? <p className="text-xs font-semibold text-soil">{message}</p> : null}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import {
  importPayouts,
  issueSignInLink,
  recordPayout,
  recordRefund,
  runUpkeep,
  saveFeeSettings,
  saveTradeSettings,
  saveVetSettings,
  setCommission,
  setRoles,
  setUserStatus,
  verifyFarm,
} from '@/domains/admin/actions';

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
              className={`chip min-h-11 cursor-pointer px-3.5 text-sm font-bold ${on ? 'border-forest bg-forest text-white' : ''}`}
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
            className="btn-primary min-h-11 w-auto px-4 text-sm"
            onClick={() => {
              const name = user.full_name || user.email || user.phoneDisplay || '';
              if (roles.includes('admin') && !user.roles.includes('admin') && !window.confirm(t('confirmAdmin', { name }))) return;
              run(() => setRoles(user.id, roles));
            }}
          >
            {t('saveRoles')}
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          className="btn-secondary min-h-11 w-auto px-4 text-sm"
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
            className="btn-secondary min-h-11 w-auto px-4 text-sm"
            onClick={() => {
              const name = user.full_name || user.email || user.phoneDisplay || '';
              if (user.status === 'active' && !window.confirm(t('confirmSuspend', { name }))) return;
              run(() => setUserStatus(user.id, user.status === 'active' ? 'suspended' : 'active'));
            }}
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

export function FarmVerifyButton({ farmId, farmName, verified }: { farmId: string; farmName: string; verified: boolean }) {
  const t = useTranslations('admin');
  const { pending, run } = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      className={`${verified ? 'btn-secondary' : 'btn-primary'} min-h-11 w-auto shrink-0 px-3.5 text-sm`}
      onClick={() => {
        if (!window.confirm(t(verified ? 'confirmUnverify' : 'confirmVerify', { farm: farmName }))) return;
        run(() => verifyFarm(farmId, !verified));
      }}
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
          className="input min-h-11 tabular-nums"
        />
        <input
          aria-label={t('reference')}
          placeholder={t('reference')}
          value={ref}
          onChange={(e) => setRef(e.target.value.toUpperCase())}
          className="input min-h-11 font-mono"
        />
        <button
          type="button"
          disabled={pending || !ref}
          className="btn-primary col-span-2 min-h-11 text-sm"
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
          className="input min-h-11 font-mono"
        />
        <button
          type="button"
          disabled={pending || !ref}
          className="btn-primary min-h-11 w-auto px-3 text-sm"
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

export function PayoutImport() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string[]>([]);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const r = await importPayouts(form);
          if (!r.ok) setMessage([t('error', { reason: r.error })]);
          else
            setMessage([
              t('importResult', { ok: r.data.ok, failed: r.data.failed.length }),
              ...r.data.failed.map((f) => t('importRowError', { row: f.row, reason: f.reason })),
            ]);
          router.refresh();
        });
      }}
    >
      <label htmlFor="payout-file" className="text-sm font-bold">
        {t('importLabel')}
      </label>
      <input id="payout-file" name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
      <button type="submit" disabled={pending} className="btn-primary min-h-11 text-sm">
        {t('importButton')}
      </button>
      {message.length ? (
        <ul role="status" className="text-xs font-semibold text-soil">
          {message.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function TradeSettingsForm({
  autoCompleteDays,
  unpaidHours,
  declineHours,
  plans,
}: {
  autoCompleteDays: number;
  unpaidHours: number;
  declineHours: number;
  plans: string;
}) {
  const t = useTranslations('admin');
  const [days, setDays] = useState(String(autoCompleteDays));
  const [hours, setHours] = useState(String(unpaidHours));
  const [decline, setDecline] = useState(String(declineHours));
  const [planText, setPlanText] = useState(plans);
  const { pending, message, run } = useRun();
  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor="set-days" className="text-sm font-bold">
        {t('autoComplete')}
      </label>
      <input
        id="set-days"
        inputMode="numeric"
        value={days}
        onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
        className="input tabular-nums"
      />
      <label htmlFor="set-hours" className="text-sm font-bold">
        {t('unpaidHours')}
      </label>
      <input
        id="set-hours"
        inputMode="numeric"
        value={hours}
        onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))}
        className="input tabular-nums"
      />
      <label htmlFor="set-decline" className="text-sm font-bold">
        {t('declineHours')}
      </label>
      <input
        id="set-decline"
        inputMode="numeric"
        value={decline}
        onChange={(e) => setDecline(e.target.value.replace(/\D/g, ''))}
        className="input tabular-nums"
      />
      <label htmlFor="set-plans" className="text-sm font-bold">
        {t('plans')}
      </label>
      <textarea id="set-plans" value={planText} onChange={(e) => setPlanText(e.target.value)} rows={3} className="input py-3 font-mono" />
      <span className="text-xs text-soil">{t('plansHint')}</span>
      <button
        type="button"
        disabled={pending}
        className="btn-primary"
        onClick={() =>
          run(() =>
            saveTradeSettings({
              autoCompleteDays: Number(days),
              unpaidHours: Number(hours),
              declineHours: Number(decline),
              plans: planText,
            }),
          )
        }
      >
        {t('save')}
      </button>
      {message ? <p className="text-xs font-semibold text-soil">{message}</p> : null}
    </div>
  );
}

export function UpkeepButton() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        className="btn-secondary"
        onClick={() =>
          start(async () => {
            const r = await runUpkeep();
            setMessage(
              r.ok
                ? t('upkeepDone', {
                    completed: r.data.auto_completed ?? 0,
                    cancelled: r.data.unpaid_cancelled ?? 0,
                    declined: r.data.unanswered_declined ?? 0,
                    expired: r.data.payments_expired ?? 0,
                    ended: r.data.promotions_ended ?? 0,
                  })
                : t('error', { reason: r.error }),
            );
            router.refresh();
          })
        }
      >
        {t('runUpkeep')}
      </button>
      {message ? (
        <p role="status" className="text-xs font-semibold text-soil">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function VetSettingsForm({ vetHours }: { vetHours: number }) {
  const t = useTranslations('admin');
  const [hours, setHours] = useState(String(vetHours));
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor="vet-hours" className="text-sm font-bold">
        {t('vetHours')}
      </label>
      <input
        id="vet-hours"
        inputMode="numeric"
        value={hours}
        onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))}
        className="input tabular-nums"
      />
      <button
        type="button"
        disabled={pending}
        className="btn-primary"
        onClick={() =>
          start(async () => {
            const r = await saveVetSettings({ vetHours: Number(hours) });
            setMessage(r.ok ? t('done') : r.error);
          })
        }
      >
        {t('save')}
      </button>
      {message ? <p className="text-xs font-semibold text-soil">{message}</p> : null}
    </div>
  );
}

type FeeRule = { percent?: number; bands?: { upto: number | null; fee: number }[] };
const ruleText = (r: FeeRule | undefined) => ({
  bands: (r?.bands ?? []).map((b) => `${b.upto ?? '*'}, ${b.fee}`).join('\n'),
  percent: r?.percent ? String(r.percent) : '',
});

/** Pesi charges carried by farmers: collection charge per paid order, payout charge per channel. */
export function PesiFeesForm({ collection, payout }: { collection: FeeRule | undefined; payout: Record<string, FeeRule> | undefined }) {
  const t = useTranslations('payouts');
  const channels = ['M', 'B', 'PAYBILL', 'TILL'] as const;
  const [rules, setRules] = useState(
    () =>
      ({
        collection: ruleText(collection),
        ...Object.fromEntries(channels.map((c) => [c, ruleText(payout?.[c])])),
      }) as Record<'collection' | (typeof channels)[number], { bands: string; percent: string }>,
  );
  const { pending, message, run } = useRun();
  const set = (k: keyof typeof rules, field: 'bands' | 'percent', v: string) => setRules((r) => ({ ...r, [k]: { ...r[k], [field]: v } }));
  const block = (k: keyof typeof rules, label: string) => (
    <fieldset key={k} className="flex flex-col gap-1.5 rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-bold">{label}</legend>
      <textarea
        rows={3}
        value={rules[k].bands}
        placeholder={t('feesExample')}
        onChange={(e) => set(k, 'bands', e.target.value)}
        className="input min-h-20 py-2 font-mono text-sm"
        aria-label={label}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          inputMode="decimal"
          value={rules[k].percent}
          onChange={(e) => set(k, 'percent', e.target.value.replace(/[^\d.]/g, ''))}
          className="input w-20 tabular-nums"
        />
        {t('percent')}
      </label>
    </fieldset>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="text-lg font-bold">{t('feesTitle')}</h2>
      <p className="text-sm text-soil">{t('feesIntro')}</p>
      {block('collection', t('feesCollection'))}
      <div className="grid gap-2.5 sm:grid-cols-2">{channels.map((c) => block(c, t('feesPayout', { channel: t(`channel${c}`) })))}</div>
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          run(() =>
            saveFeeSettings({ collection: rules.collection, payout: { M: rules.M, B: rules.B, PAYBILL: rules.PAYBILL, TILL: rules.TILL } }),
          )
        }
      >
        {t('feesSave')}
      </button>
      {message ? <p className="text-sm font-semibold">{message}</p> : null}
    </div>
  );
}

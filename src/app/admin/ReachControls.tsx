'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { saveReachSettings, sendQueuedSms, simulateUssd } from '@/domains/admin/actions';
import { reviewBroadcast } from '@/domains/broadcasts/actions';
import { Icon } from '@/components/Icon';

export function SendNowButton() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className="btn-secondary min-h-10 w-auto px-4 text-sm"
        onClick={() =>
          start(async () => {
            const r = await sendQueuedSms();
            setMessage(r.ok ? t('sendResult', r.data) : r.error);
            router.refresh();
          })
        }
      >
        <Icon name="send" size={16} />
        {t('sendNow')}
      </button>
      {message ? <span className="text-sm font-semibold text-soil">{message}</span> : null}
    </div>
  );
}

export function BroadcastReview({ id }: { id: string }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const act = (approve: boolean) =>
    start(async () => {
      const r = await reviewBroadcast(id, approve, note);
      if (r.ok) router.refresh();
      else setError(r.detail ?? r.error);
    });
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder={t('note')}
        aria-label={t('note')}
        className="input min-h-10 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => act(true)} className="btn-primary min-h-10 w-auto px-4 text-sm">
          <Icon name="check" size={16} />
          {t('approve')}
        </button>
        <button type="button" disabled={pending} onClick={() => act(false)} className="btn-secondary min-h-10 w-auto px-4 text-sm">
          {t('reject')}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-soil">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A feature-phone screen that drives the real USSD handler. */
export function UssdSimulator({ code }: { code: string }) {
  const t = useTranslations('admin');
  const [phone, setPhone] = useState('0700 000 002');
  const [path, setPath] = useState<string[] | null>(null);
  const [screen, setScreen] = useState('');
  const [ended, setEnded] = useState(false);
  const [input, setInput] = useState('');
  const [pending, start] = useTransition();

  const send = (next: string[]) =>
    start(async () => {
      const r = await simulateUssd(phone, next.join('*'));
      const reply = r.ok ? r.data.reply : `END ${r.error}`;
      setPath(next);
      setEnded(reply.startsWith('END'));
      setScreen(reply.replace(/^(CON|END) /, ''));
      setInput('');
    });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex flex-col gap-2 sm:w-56">
        <label htmlFor="ussd-phone" className="text-sm font-bold">
          {t('ussdPhone')}
        </label>
        <input id="ussd-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input tabular-nums" />
        <button type="button" disabled={pending} onClick={() => send([])} className="btn-primary min-h-10 text-sm">
          <Icon name="phone" size={16} />
          {t('ussdDial', { code: code || '*384*12#' })}
        </button>
      </div>
      <div className="w-full max-w-xs rounded-[28px] border-4 border-forest bg-forest p-3 shadow-lg">
        <div
          className="min-h-48 whitespace-pre-wrap rounded-2xl bg-[#d9e8c4] p-3 font-mono text-[13px] leading-snug text-[#1d2a12]"
          aria-live="polite"
        >
          {path === null ? '…' : screen}
          {ended ? <span className="mt-2 block text-xs opacity-70">— {t('ussdEnded')} —</span> : null}
        </div>
        {path !== null && !ended ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) send([...path, input.trim()]);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              inputMode="numeric"
              autoFocus
              aria-label={t('ussdReply')}
              className="min-h-10 w-full rounded-xl bg-white px-3 font-mono"
            />
            <button type="submit" disabled={pending} className="rounded-xl bg-lime px-3 text-sm font-bold text-forest">
              {t('ussdSend')}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function ReachSettingsForm(props: {
  smsDailyCap: number;
  smsCost: number;
  ussdCode: string;
  vetAlertMax: number;
  vetHours: number;
}) {
  const t = useTranslations('admin');
  const [v, setV] = useState({
    smsDailyCap: String(props.smsDailyCap),
    smsCost: String(props.smsCost),
    ussdCode: props.ussdCode,
    vetAlertMax: String(props.vetAlertMax),
    vetHours: String(props.vetHours),
  });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const fields = [
    ['smsDailyCap', 'smsCap', 'numeric'],
    ['smsCost', 'smsCost', 'decimal'],
    ['ussdCode', 'ussdCode', 'text'],
    ['vetAlertMax', 'vetAlertMax', 'numeric'],
    ['vetHours', 'vetHours', 'numeric'],
  ] as const;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label, mode]) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={`reach-${key}`} className="text-sm font-bold">
              {t(label)}
            </label>
            <input
              id={`reach-${key}`}
              inputMode={mode}
              value={v[key]}
              onChange={(e) => setV({ ...v, [key]: e.target.value })}
              className="input tabular-nums"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={pending}
        className="btn-primary"
        onClick={() =>
          start(async () => {
            const r = await saveReachSettings({
              smsDailyCap: Number(v.smsDailyCap),
              smsCost: Number(v.smsCost),
              ussdCode: v.ussdCode,
              vetAlertMax: Number(v.vetAlertMax),
              vetHours: Number(v.vetHours),
            });
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

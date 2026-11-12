'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { savePayoutAccountAction } from '@/domains/admin/payout-actions';
import type { Channel, PayoutAccount } from '@/domains/admin/disbursements';

const CHANNELS: Channel[] = ['M', 'B', 'PAYBILL', 'TILL'];

export function PayoutAccountForm({
  farmId,
  current,
  banks,
  defaultMobile,
}: {
  farmId: string;
  current: PayoutAccount | null;
  banks: { code: string; name: string }[];
  defaultMobile: string;
}) {
  const t = useTranslations('payouts');
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(current?.channel ?? 'M');
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(form: FormData) {
    const get = (k: string) => String(form.get(k) ?? '').trim() || null;
    start(async () => {
      const r = await savePayoutAccountAction(farmId, {
        channel,
        mobile: get('mobile'),
        bank_code: get('bank_code'),
        account_number: get('account_number'),
        business_number: get('business_number'),
      });
      if (r.ok) {
        setResult({ ok: true, text: t('saved', { name: r.data.registeredName }) });
        router.refresh();
      } else if (r.error.startsWith('check:')) {
        setResult({ ok: false, text: t('err_check', { reason: r.error.slice(6) }) });
      } else {
        setResult({ ok: false, text: t.has(`err_${r.error}`) ? t(`err_${r.error}` as never) : r.error });
      }
    });
  }

  const input = 'h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base';
  return (
    <form action={submit} className="flex flex-col gap-3.5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">{t('channel')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHANNELS.map((c) => (
            <label
              key={c}
              className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-bold ${
                channel === c ? 'border-forest bg-forest text-surface' : 'border-line bg-surface'
              }`}
            >
              <input type="radio" name="channel" value={c} checked={channel === c} onChange={() => setChannel(c)} className="sr-only" />
              {t(`channel${c}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {channel === 'M' ? (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t('mobile')}
          <input
            name="mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={current?.mobile ? '0' + current.mobile.slice(3) : defaultMobile}
            className={input}
            required
          />
        </label>
      ) : null}
      {channel === 'B' ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('bank')}
            <select name="bank_code" defaultValue={current?.bank_code ?? ''} className={input} required>
              <option value="" disabled>
                {t('chooseBank')}
              </option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('accountNumber')}
            <input
              name="account_number"
              inputMode="numeric"
              defaultValue={current?.channel === 'B' ? (current.account_number ?? '') : ''}
              className={input}
              required
            />
          </label>
        </>
      ) : null}
      {channel === 'PAYBILL' ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('paybill')}
            <input
              name="business_number"
              inputMode="numeric"
              defaultValue={current?.channel === 'PAYBILL' ? (current.business_number ?? '') : ''}
              className={input}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('paybillAccount')}
            <input
              name="account_number"
              defaultValue={current?.channel === 'PAYBILL' ? (current.account_number ?? '') : ''}
              className={input}
              required
            />
          </label>
        </>
      ) : null}
      {channel === 'TILL' ? (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t('till')}
          <input
            name="business_number"
            inputMode="numeric"
            defaultValue={current?.channel === 'TILL' ? (current.business_number ?? '') : ''}
            className={input}
            required
          />
        </label>
      ) : null}

      <p className="text-xs text-soil">{t('nameHint')}</p>
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? t('saving') : t('save')}
      </button>
      {result ? (
        <p
          role="status"
          className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${result.ok ? 'bg-sprout/15 text-sprout-deep' : 'bg-amber/15'}`}
        >
          {result.text}
        </p>
      ) : null}
    </form>
  );
}

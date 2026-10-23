import { createTranslator } from 'next-intl';
import en from '../../../messages/en.json';
import sw from '../../../messages/sw.json';

// Turns an outbox row (template + params) into SMS text in the phone's
// language. Wording lives in messages/{en,sw}.json under "sms" so it is
// translated with the rest of the app.

export type SmsLocale = 'en' | 'sw';
type Params = Record<string, unknown>;

const translators = {
  en: createTranslator({ locale: 'en', messages: en, namespace: 'sms' }),
  sw: createTranslator({ locale: 'sw', messages: sw, namespace: 'sms' }),
};

export const SMS_TEMPLATES = [
  'order_paid',
  'order_ready',
  'order_declined',
  'payout_sent',
  'refund_sent',
  'vet_request',
  'vet_request_received',
  'vet_accepted',
  'vet_cancelled',
  'broadcast',
] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function localPhone(v: unknown): string {
  const d = str(v).replace(/\D/g, '');
  return /^254[17]\d{8}$/.test(d) ? `0${d.slice(3)}` : str(v);
}

function shortDate(v: unknown, locale: SmsLocale): string {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return '';
  const d = new Date(`${s.slice(0, 10)}T12:00:00+03:00`);
  return new Intl.DateTimeFormat(locale === 'sw' ? 'sw-KE' : 'en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(d);
}

/** GSM-7 friendly: SMS with curly quotes or emoji cost 2-3x (UCS-2). */
function gsm(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim();
}

export function renderSms(
  template: string,
  locale: SmsLocale,
  params: Params,
  extra: { ussdCode: string; broadcast?: { body_en: string; body_sw: string } | null },
): string {
  const t = translators[locale] ?? translators.sw;
  const ussd = extra.ussdCode;
  switch (template as SmsTemplate) {
    case 'order_paid': {
      const visit = shortDate(params.visit, locale);
      return gsm(
        t('order_paid', { number: str(params.number), total: str(params.total), items: Number(params.items ?? 1), ussd }) +
          (visit ? ` ${t('visitOn', { date: visit })}` : ''),
      );
    }
    case 'order_ready':
      return gsm(
        t('order_ready', { number: str(params.number), farm: str(params.farm) }) +
          (params.phone ? ` ${t('callFarm', { phone: localPhone(params.phone) })}` : ''),
      );
    case 'order_declined':
      return gsm(t('order_declined', { number: str(params.number), farm: str(params.farm) }));
    case 'payout_sent':
      return gsm(t('payout_sent', { amount: str(params.amount), ref: str(params.ref) }));
    case 'refund_sent':
      return gsm(t('refund_sent', { amount: str(params.amount), ref: str(params.ref), number: str(params.number) }));
    case 'vet_request': {
      const animal = (params.animal as Record<string, string> | undefined)?.[locale] ?? '';
      const about = str(params.about);
      return gsm(
        t('vet_request', {
          number: str(params.number),
          animal,
          place: str(params.place) || '-',
          urgency: t(params.urgency === 'this_week' ? 'thisWeek' : 'today'),
          ussd,
        }) + (about ? ` "${about}"` : ''),
      );
    }
    case 'vet_request_received':
      return gsm(t('vet_request_received', { number: str(params.number), vets: Number(params.vets ?? 0) }));
    case 'vet_accepted':
      return gsm(
        t('vet_accepted', { number: str(params.number), vet: str(params.vet), farm: str(params.farm), phone: localPhone(params.phone) }),
      );
    case 'vet_cancelled':
      return gsm(t('vet_cancelled', { number: str(params.number) }));
    case 'broadcast': {
      const body = extra.broadcast ? (locale === 'en' ? extra.broadcast.body_en : extra.broadcast.body_sw) : '';
      return gsm(`${str(params.org)}: ${body} ${t('stop')}`);
    }
    default:
      return '';
  }
}

/** Number of SMS parts a text uses (GSM-7: 160, then 153 per part). */
export function smsParts(text: string): number {
  // eslint-disable-next-line no-control-regex
  const unicode = /[^\x00-\x7F£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

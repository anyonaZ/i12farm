// Kenyan mobile numbers: 07xx / 01xx, or +254 / 254 followed by 7xx / 1xx.
const KE_MOBILE = /^(?:\+?254|0)([71]\d{8})$/;

export function isKenyanMobile(input: string): boolean {
  return KE_MOBILE.test(input.replace(/[\s-]/g, ''));
}

/** "0712 345 678" → "254712345678" (for wa.me and tel: links). */
export function toInternational(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.replace(/[\s-]/g, '').match(KE_MOBILE);
  return m ? `254${m[1]}` : null;
}

/** Store numbers in one shape: +2547XXXXXXXX. */
export function normalisePhone(input: string): string | null {
  const intl = toInternational(input);
  return intl ? `+${intl}` : null;
}

/** "+254712345678" → "0712 345 678" for display. */
export function displayPhone(input: string | null | undefined): string {
  const intl = toInternational(input);
  if (!intl) return input ?? '';
  const local = '0' + intl.slice(3);
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

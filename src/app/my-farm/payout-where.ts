import type { PayoutAccountInput } from '@/domains/admin/disbursements';

/** "M-Pesa 0712 345 678", "EQUITY BANK LIMITED ·· 6789", "Paybill 247247 · 12345", "Till number 56302" */
export function payoutWhere(
  a: PayoutAccountInput & { bank_name?: string | null },
  label: (key: 'channelM' | 'channelB' | 'channelPAYBILL' | 'channelTILL') => string,
): string {
  switch (a.channel) {
    case 'M':
      return `${label('channelM')} ${a.mobile ? '0' + a.mobile.slice(3, 6) + ' ' + a.mobile.slice(6, 9) + ' ' + a.mobile.slice(9) : ''}`;
    case 'B':
      return `${a.bank_name ?? label('channelB')} ·· ${(a.account_number ?? '').slice(-4)}`;
    case 'PAYBILL':
      return `${label('channelPAYBILL')} ${a.business_number ?? ''} · ${a.account_number ?? ''}`;
    case 'TILL':
      return `${label('channelTILL')} ${a.business_number ?? ''}`;
  }
}

export function kes(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '';
  return 'KES ' + Number(amount).toLocaleString('en-KE', { maximumFractionDigits: 0 });
}

export function formatQty(qty: number | string | null | undefined): string {
  if (qty === null || qty === undefined) return '';
  return Number(qty).toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

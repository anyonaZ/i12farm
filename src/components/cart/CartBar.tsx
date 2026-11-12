'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/Icon';
import { cartTotals, useCart } from '@/lib/cart';
import { kes } from '@/lib/format';

// Sits above the contact bar on a farm page once something from this farm is in the cart.
export function CartBar({ farmId, variant = 'bar' }: { farmId: string; variant?: 'bar' | 'panel' }) {
  const t = useTranslations('cart');
  const cart = useCart();
  if (!cart || cart.farmId !== farmId) return null;
  const { items, total } = cartTotals(cart);
  if (items === 0) return null;
  if (variant === 'panel') {
    return (
      <Link href={`/checkout?farm=${encodeURIComponent(cart.farmSlug)}`} className="btn-primary min-h-13 justify-between bg-ink px-5">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Icon name="bag" size={18} />
          {t('items', { n: items })}
        </span>
        <span className="font-extrabold tabular-nums">{t('checkout', { total: kes(total) })}</span>
      </Link>
    );
  }
  return (
    <div className="fixed inset-x-0 bottom-[calc(8.5rem+env(safe-area-inset-bottom))] z-30 px-4 lg:hidden">
      <Link
        href={`/checkout?farm=${encodeURIComponent(cart.farmSlug)}`}
        className="mx-auto flex min-h-14 max-w-md items-center justify-between gap-3 rounded-full bg-ink px-5 text-white shadow-[0_8px_24px_rgba(5,59,43,0.35)]"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Icon name="bag" size={18} />
          {t('items', { n: items })}
        </span>
        <span className="font-extrabold tabular-nums">{t('checkout', { total: kes(total) })}</span>
      </Link>
    </div>
  );
}

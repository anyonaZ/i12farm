'use client';

import { useCart } from '@/lib/cart';

export { setLine } from '@/lib/cart';
export { track } from '@/lib/analytics/track';

/** This listing's cart line, and the other farm's name if the cart belongs to a different farm. */
export function useCartLine(farmId: string, listingId: string) {
  const cart = useCart();
  const sameFarm = cart?.farmId === farmId;
  return {
    line: sameFarm ? (cart?.lines[listingId] ?? null) : null,
    otherFarm: cart && !sameFarm ? cart.farmName : null,
  };
}

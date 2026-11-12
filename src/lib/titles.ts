import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

type TitleKey =
  | 'admin' | 'payoutBatch' | 'payouts' | 'signIn' | 'createAccount' | 'orders' | 'account' | 'notFound' | 'editFarm'
  | 'myFarm' | 'payoutDetails' | 'featureFarm' | 'pinFarm' | 'vets' | 'farmNotFound' | 'checkout' | 'prices'
  | 'partner' | 'terms' | 'messages' | 'inbox' | 'privacy';

/** A page's browser-tab title in the reader's language. */
export function titled(key: TitleKey, extra: Metadata = {}) {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('titles');
    return { ...extra, title: t(key) };
  };
}

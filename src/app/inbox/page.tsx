import { getTranslations } from 'next-intl/server';
import { LanguageSwitch } from '@/components/LanguageSwitch';

export const metadata = { title: 'Inbox' };

export default async function InboxPage() {
  const t = await getTranslations('inbox');
  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('title')}</h1>
        <LanguageSwitch />
      </header>
      <p className="card text-soil">{t('empty')}</p>
    </main>
  );
}

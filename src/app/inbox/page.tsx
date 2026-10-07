import { getTranslations } from 'next-intl/server';

export const metadata = { title: 'Inbox' };

export default async function InboxPage() {
  const t = await getTranslations('inbox');
  return (
    <main className="flex flex-col gap-4 px-4 pt-8">
      <h1 className="text-2xl font-extrabold">{t('title')}</h1>
      <p className="card text-soil">{t('empty')}</p>
    </main>
  );
}

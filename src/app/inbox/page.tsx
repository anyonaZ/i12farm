import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { FarmCover } from '@/components/farm/FarmCover';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { listConversations } from '@/domains/messaging/queries';
import { requireViewer } from '@/lib/auth/viewer';

export const metadata = { title: 'Inbox', robots: { index: false } };

export default async function InboxPage() {
  const viewer = await requireViewer('/inbox');
  const t = await getTranslations();
  const format = await getFormatter();
  const conversations = await listConversations(viewer);

  return (
    <main className="mx-auto w-full flex flex-col gap-4 px-4 pb-24 pt-8 lg:max-w-3xl lg:px-8 lg:pb-16 lg:pt-10">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold tracking-tight">{t('inbox.title')}</h1>
        <LanguageSwitch />
      </header>
      {conversations.length === 0 ? (
        <p className="card text-soil">{t('inbox.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/inbox/${c.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <span className="size-12 shrink-0 overflow-hidden rounded-xl">
                  <FarmCover id={c.farm_id} name={c.farm_name} category={undefined} sizes="48px" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <b className="truncate">{c.i_am_buyer ? c.farm_name : `${c.other_name} · ${c.farm_name}`}</b>
                    <span className="shrink-0 text-xs text-soil">{format.relativeTime(new Date(c.last_message_at))}</span>
                  </span>
                  <span className={`block truncate text-sm ${c.unread ? 'font-bold text-forest' : 'text-soil'}`}>
                    {c.last_kind === 'order' ? t(`orders.event.${c.last_body}`) : c.last_body}
                  </span>
                </span>
                {c.unread ? (
                  <span
                    className="grid min-w-6 place-items-center rounded-full bg-sprout-deep px-1.5 text-xs font-bold text-white"
                    aria-label={t('inbox.unread', { n: c.unread })}
                  >
                    {c.unread}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

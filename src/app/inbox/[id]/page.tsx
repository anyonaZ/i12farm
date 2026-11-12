import { titled } from '@/lib/titles';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { getConversation } from '@/domains/messaging/queries';
import { requireViewer } from '@/lib/auth/viewer';
import { Thread } from './Thread';

export const generateMetadata = titled('messages', { robots: { index: false } });

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer(`/inbox/${id}`);
  const conv = await getConversation(viewer, id);
  if (!conv) notFound();
  const t = await getTranslations('inbox');

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] w-full flex-col lg:h-[calc(100dvh-4rem)] lg:max-w-3xl lg:border-x lg:border-line lg:bg-surface">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link href="/inbox" className="grid size-11 shrink-0 place-items-center rounded-full border border-line" aria-label={t('back')}>
          <Icon name="back" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{conv.i_am_buyer ? conv.farm_name : conv.other_name}</h1>
          <p className="truncate text-sm text-soil">{conv.i_am_buyer ? conv.other_name : t('aboutFarm', { farm: conv.farm_name })}</p>
        </div>
        <Link href={`/f/${conv.farm_slug}`} className="inline-flex min-h-11 shrink-0 items-center px-1 text-sm font-bold text-sprout-deep">
          {t('viewFarm')}
        </Link>
      </header>
      <Thread conversationId={conv.id} initial={conv.messages} otherName={conv.i_am_buyer ? conv.farm_name : conv.other_name} />
    </main>
  );
}

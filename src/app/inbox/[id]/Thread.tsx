'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { sendMessage } from '@/domains/messaging/actions';
import type { MessageRow } from '@/domains/messaging/queries';

const POLL_MS = 5000;

export function Thread({ conversationId, initial, otherName }: { conversationId: string; initial: MessageRow[]; otherName: string }) {
  const t = useTranslations();
  const [messages, setMessages] = useState<MessageRow[]>(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id ?? 0;

  const merge = useCallback((rows: MessageRow[]) => {
    if (!rows.length) return;
    setMessages((current) => {
      const seen = new Set(current.map((m) => m.id));
      return [...current, ...rows.filter((r) => !seen.has(r.id))];
    });
  }, []);

  // Poll for new messages while the page is visible.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const response = await fetch(`/api/conversations/${conversationId}/messages?after=${lastId}`, { cache: 'no-store' }).catch(
        () => null,
      );
      if (!stopped && response?.ok) merge((await response.json()) as MessageRow[]);
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [conversationId, lastId, merge]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  function send(event: React.FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    start(async () => {
      setError('');
      const r = await sendMessage(conversationId, body, lastId);
      if (r.ok) {
        setText('');
        merge(r.data);
      } else {
        setError(r.error);
      }
    });
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });

  return (
    <>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4" aria-live="polite">
        <p className="mx-auto mb-2 flex max-w-xs items-start gap-2 rounded-xl bg-surface px-3 py-2 text-xs text-soil">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-sprout-deep" />
          {t('inbox.safety')}
        </p>
        {messages.map((m) =>
          m.kind === 'order' ? (
            <div key={m.id} className="mx-auto my-1 rounded-full bg-mint px-3 py-1 text-center text-xs font-semibold text-soil">
              {m.order_number ? (
                <Link href={`/orders/${m.order_number}`} className="text-sprout-deep underline">
                  {t('inbox.orderLink', { number: m.order_number })}
                </Link>
              ) : null}{' '}
              · {t.has(`orders.event.${m.body}`) ? t(`orders.event.${m.body}`) : m.body} · {time(m.created_at)}
            </div>
          ) : (
            <div key={m.id} className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
                  m.mine ? 'rounded-br-md bg-sprout-deep text-white' : 'rounded-bl-md border border-line bg-surface'
                }`}
              >
                {m.body}
              </div>
              <span className="mt-0.5 px-1 text-[11px] text-soil">
                {m.mine ? t('inbox.you') : otherName} · {time(m.created_at)}
              </span>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5">
        <label htmlFor="msg" className="sr-only">
          {t('inbox.placeholder')}
        </label>
        <textarea
          id="msg"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          rows={1}
          maxLength={2000}
          placeholder={t('inbox.placeholder')}
          className="input max-h-32 min-h-12 flex-1 resize-none py-3"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-sprout-deep text-white disabled:opacity-50"
          aria-label={t('inbox.send')}
        >
          <Icon name="send" size={20} />
        </button>
      </form>
      {error ? (
        <p role="alert" className="bg-amber/15 px-4 py-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/Icon';

// A sideways row of chips or tabs. Phones swipe it. On a computer a mouse
// can't swipe, so the row also:
//  - shows ‹ › buttons at an edge that has more behind it,
//  - turns the mouse wheel into sideways scrolling while over it,
//  - can be dragged with the mouse.
// Fades at the edges show there is more to see on any device.
export function ScrollRow({
  children,
  className = '',
  label,
  role = 'group',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
  role?: string;
  as?: 'div' | 'nav';
}) {
  const t = useTranslations('app');
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener('scroll', measure, { passive: true });

    // Vertical wheel → sideways, only when the row can move that way, so the
    // page still scrolls once the row reaches its end.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = el.scrollLeft + e.deltaY;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, next));
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // Keep the chosen chip in view (e.g. after a page reload on "Kisumu").
    const current = el.querySelector<HTMLElement>('[aria-pressed="true"],[aria-current="page"],[aria-selected="true"]');
    if (current && current.offsetLeft + current.offsetWidth > el.clientWidth) {
      el.scrollLeft = current.offsetLeft - el.clientWidth / 2 + current.offsetWidth / 2;
    }

    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
    };
  }, [measure]);

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  // Mouse drag (touch already scrolls natively). A drag doesn't count as a tap.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { x: e.clientX, left: ref.current!.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      ref.current!.setPointerCapture(e.pointerId);
    }
    if (d.moved) ref.current!.scrollLeft = d.left - dx;
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      ref.current!.releasePointerCapture?.(e.pointerId);
      // Swallow the click that follows a drag.
      const stop = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
    }
  };

  const mask =
    edges.start && edges.end
      ? 'linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent)'
      : edges.end
        ? 'linear-gradient(to right, #000 calc(100% - 2.5rem), transparent)'
        : edges.start
          ? 'linear-gradient(to right, transparent, #000 2.5rem)'
          : undefined;

  return (
    <Tag className="group/row pointer-events-auto relative min-w-0" aria-label={Tag === 'nav' ? label : undefined}>
      <div
        ref={ref}
        role={Tag === 'nav' ? undefined : role}
        aria-label={Tag === 'nav' ? undefined : label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className={`flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children}
      </div>
      {/* Computer only (fine pointer); phones swipe. */}
      {edges.start ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('scrollBack')}
          onClick={() => nudge(-1)}
          className="absolute left-0 top-1/2 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-forest shadow-md transition hover:bg-mint [@media(pointer:fine)]:grid"
        >
          <Icon name="back" size={18} />
        </button>
      ) : null}
      {edges.end ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('scrollMore')}
          onClick={() => nudge(1)}
          className="absolute right-0 top-1/2 hidden size-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-forest shadow-md transition hover:bg-mint [@media(pointer:fine)]:grid"
        >
          <Icon name="back" size={18} className="rotate-180" />
        </button>
      ) : null}
    </Tag>
  );
}

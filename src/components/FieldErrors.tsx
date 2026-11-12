'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Shown = { el: Field; text: string; top: number; left: number; width: number };

// Replaces the browser's own "Please fill out this field" bubbles (always in
// the browser's language, and styled by the browser) with a message under the
// field, in the reader's language. Works for every form in the app: it listens
// for the "invalid" event, which fires when a form with required/min/type
// rules is submitted. A field can give its own text with data-error="...".
export function FieldErrors() {
  const t = useTranslations('forms');
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let firstThisSubmit = true;
    const reset = () => {
      firstThisSubmit = true;
    };

    const messageFor = (el: Field): string => {
      const v = el.validity;
      const custom = el.getAttribute('data-error');
      if (custom) return custom;
      if (v.valueMissing) {
        if (el instanceof HTMLInputElement && el.type === 'checkbox') return t('tick');
        if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'radio')) return t('choose');
        return t('required');
      }
      if (v.tooShort) return t('tooShort', { n: (el as HTMLInputElement).minLength });
      if (v.tooLong) return t('tooLong', { n: (el as HTMLInputElement).maxLength });
      if (v.typeMismatch) return (el as HTMLInputElement).type === 'email' ? t('email') : t('format');
      if (v.rangeUnderflow) return t('min', { n: (el as HTMLInputElement).min });
      if (v.rangeOverflow) return t('max', { n: (el as HTMLInputElement).max });
      if (v.stepMismatch) return t('step');
      if (v.badInput) return t('number');
      return t('format');
    };

    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
      e.preventDefault(); // no browser bubble
      el.setAttribute('aria-invalid', 'true');
      if (!firstThisSubmit) return;
      firstThisSubmit = false;
      window.setTimeout(reset, 0); // after every "invalid" of this submit has fired
      // Radios and checkboxes: point at the label row, not the tiny box.
      const anchor = (el.type === 'radio' || el.type === 'checkbox' ? el.closest('label, fieldset') : null) ?? el;
      const r = anchor.getBoundingClientRect();
      el.focus({ preventScroll: true });
      anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const box = anchor.getBoundingClientRect();
      setShown({
        el,
        text: messageFor(el),
        top: box.bottom + window.scrollY + 6,
        left: Math.max(8, r.left + window.scrollX),
        width: Math.min(r.width, window.innerWidth - 16),
      });
      el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby'), 'field-error'].filter(Boolean).join(' '));
    };

    const clear = (e: Event) => {
      const el = e.target as Field;
      if (el?.getAttribute?.('aria-invalid') === 'true' && el.checkValidity?.()) {
        el.removeAttribute('aria-invalid');
        const ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== 'field-error');
        if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
        else el.removeAttribute('aria-describedby');
        setShown((s) => (s?.el === el ? null : s));
      }
    };

    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', clear, true);
    document.addEventListener('change', clear, true);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', clear, true);
      document.removeEventListener('change', clear, true);
    };
  }, [t]);

  // Re-measure after the smooth scroll and on resize, and drop the message if
  // the field leaves the page (another screen opened).
  useEffect(() => {
    if (!shown) return;
    const place = () => {
      if (!shown.el.isConnected) return setShown(null);
      const anchor =
        (shown.el.type === 'radio' || shown.el.type === 'checkbox' ? shown.el.closest('label, fieldset') : null) ?? shown.el;
      const r = anchor.getBoundingClientRect();
      setShown((s) =>
        s && (Math.abs(s.top - (r.bottom + window.scrollY + 6)) > 1 || Math.abs(s.left - (r.left + window.scrollX)) > 1)
          ? { ...s, top: r.bottom + window.scrollY + 6, left: Math.max(8, r.left + window.scrollX), width: Math.min(r.width, window.innerWidth - 16) }
          : s,
      );
    };
    const timer = window.setInterval(place, 250);
    window.addEventListener('resize', place);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', place);
    };
  }, [shown]);

  return (
    <div aria-live="assertive" className="pointer-events-none">
      {shown ? (
        <p
          id="field-error"
          className="absolute z-50 flex items-start gap-1.5 rounded-xl border border-danger/30 bg-surface px-3 py-2 text-sm font-semibold text-danger shadow-md"
          style={{ top: shown.top, left: shown.left, maxWidth: Math.max(shown.width, 220) }}
        >
          <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-danger text-[0.65rem] font-bold text-white">!</span>
          {shown.text}
        </p>
      ) : null}
    </div>
  );
}

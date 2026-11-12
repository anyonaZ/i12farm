// The i12farm mark: a map pin with a sprout inside. Drawn in code so it
// stays crisp at any size and costs no network request.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" style={{ fill: 'var(--color-ink)' }} />
      <path d="M32 10c-9.4 0-17 7.4-17 16.6C15 39 32 54 32 54s17-15 17-27.4C49 17.4 41.4 10 32 10z" style={{ fill: 'var(--color-sprout)' }} />
      <path d="M32 40V27" style={{ stroke: 'var(--color-ink)' }} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M32 29c0-6 4.2-9.6 10-9.6 0 6-4.4 9.6-10 9.6z" style={{ fill: 'var(--color-lime)' }} />
      <path d="M32 32c0-4.8-3.4-7.8-8.2-7.8 0 4.8 3.6 7.8 8.2 7.8z" style={{ fill: 'var(--color-lime)' }} />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="text-xl font-extrabold tracking-tight text-forest">
        i12<span className="text-sprout-deep">farm</span>
      </span>
    </span>
  );
}

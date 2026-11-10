// A tiny trend line for a price card. Drawn on the server; the card links to
// the full chart, which has the hover readout and a table.
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 112;
  const h = 36;
  const pad = 4;
  if (values.length < 2) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        <line x1={pad} x2={w - pad} y1={h / 2} y2={h / 2} stroke="#d8eadf" strokeWidth="2" strokeDasharray="3 4" />
        {values.length === 1 ? <circle cx={w - pad} cy={h / 2} r="3.5" fill="#067647" /> : null}
      </svg>
    );
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (values.length - 1);
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - pad * 2));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="overflow-visible">
      <path d={d} fill="none" stroke="#067647" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill="#067647" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

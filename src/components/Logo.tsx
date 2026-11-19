'use client';

import { useId } from 'react';

// The i12farm logo from the brand kit (brand/BRAND-GUIDE.md, brand/logo/).
// Drawn inline so it follows dark mode: full colour on light screens, the
// reversed version on dark ones (colours are the --logo-* variables in
// globals.css). The wordmark is the kit's outlined Outfit ExtraBold, never
// retyped. Below 24 px use the Seed i favicon instead of the mark.
//
//   LogoMark   Field Pin mark alone, where the name is already nearby
//   Logo       Field Pin + wordmark, the master logo (120 px wide at least)
//   PinSprout  not a logo: the "pin your farm" illustration

type Tone = 'auto' | 'reversed';

const PIN = 'M32 5C20.2 5 10.8 14.3 10.8 25.9 10.8 40.6 32 59 32 59S53.2 40.6 53.2 25.9C53.2 14.3 43.8 5 32 5Z';
const ROWS = [
  'M2 37.4C16 33.2 48 33.2 62 37.4',
  'M32 36.6V64',
  'M26.2 36.8 18.5 64',
  'M37.8 36.8 45.5 64',
  'M20.6 37.3 4 62',
  'M43.4 37.3 60 62',
];
const I12 = 'M50 0V-489H224.5V0.0ZM137.25 -545.5Q98.0 -545.5 72.0 -572.375Q46.0 -599.25 46.0 -638.5Q46.0 -677.75 72.0 -704.625Q98.0 -731.5 137.25 -731.5Q177.5 -731.5 203.0 -704.625Q228.5 -677.75 228.5 -638.5Q228.5 -599.25 203.0 -572.375Q177.5 -545.5 137.25 -545.5Z M401 0V-709H577.75V0.0ZM266.25 -560.25V-709.0H567.75V-560.25Z M637.0 -97.25 914.5 -380.25Q935.25 -401.5 948.125 -419.125Q961.0 -436.75 966.625 -452.5Q972.25 -468.25 972.25 -485.0Q972.25 -523.0 947.75 -545.0Q923.25 -567.0 883 -567Q845 -567 813.75 -545.375Q782.5 -523.75 750.25 -473.75L632.75 -578.0Q676.0 -648.25 743.125 -684.375Q810.25 -720.5 896.75 -720.5Q973.75 -720.5 1029.875 -692.625Q1086.0 -664.75 1116.375 -613.375Q1146.75 -562.0 1146.75 -492.0Q1146.75 -450.25 1135.875 -414.625Q1125 -379 1100.75 -344.5Q1076.5 -310.0 1037.0 -271.5L853.25 -92.75ZM637 0V-97.25L786.25 -148.75H1161.5V0.0Z';
const FARM = 'M1276.5 0.0V-519.75Q1276.5 -581.5 1303.625 -631.375Q1330.75 -681.25 1381.375 -710.875Q1432.0 -740.5 1502.5 -740.5Q1555.5 -740.5 1595.875 -723.25Q1636.25 -706.0 1664.75 -676.5L1556.25 -568.0Q1548 -577 1536.25 -581.375Q1524.5 -585.75 1510.0 -585.75Q1482.75 -585.75 1466.875 -569.875Q1451 -554 1451.0 -526.75V0ZM1172.75 -344.0V-489.0H1588.5V-344.0Z M1828.5 10.0Q1760.5 10.0 1707.625 -23.0Q1654.75 -56.0 1624.625 -113.25Q1594.5 -170.5 1594.5 -244.25Q1594.5 -318.25 1624.625 -375.875Q1654.75 -433.5 1707.625 -466.25Q1760.5 -499.0 1828.5 -499.0Q1874.5 -499.0 1912.5 -482.25Q1950.5 -465.5 1975.125 -435.75Q1999.75 -406.0 2005.0 -367.5V-121.5Q1999.75 -83.0 1975.25 -53.25Q1950.75 -23.5 1912.625 -6.75Q1874.5 10.0 1828.5 10.0ZM1866 -145Q1909 -145 1935.25 -172.875Q1961.5 -200.75 1961.5 -244.5Q1961.5 -274.0 1949.75 -296.125Q1938.0 -318.25 1916.5 -331.125Q1895 -344 1866.75 -344.0Q1838.75 -344.0 1817.25 -331.125Q1795.75 -318.25 1783.125 -295.75Q1770.5 -273.25 1770.5 -244.5Q1770.5 -215.75 1782.75 -193.25Q1795.0 -170.75 1816.875 -157.875Q1838.75 -145.0 1866 -145ZM1955.25 0.0V-131.25L1980.25 -250.5L1955.25 -368.75V-489.0H2126V0Z M2202.5 0.0V-489.0H2377V0ZM2377.0 -266.25 2299.25 -331.75Q2327.75 -414.5 2375.745398773006 -456.75Q2423.7407975460123 -499.0 2501.25 -499.0Q2535.75 -499.0 2561.375 -489.75Q2587.0 -480.5 2604.5 -462.0L2504.0 -326.5Q2495.5 -336.0 2481.291666666667 -341.625Q2467.0833333333335 -347.25 2448.5 -347.25Q2414.5 -347.25 2395.75 -326.688679245283Q2377.0 -306.12735849056605 2377.0 -266.25Z M2608.5 0.0V-489.0H2783V0ZM2915.5 0.0V-283.0Q2915.5 -313.75 2896.75 -331.25Q2878.0 -348.75 2849.75 -348.75Q2830.25 -348.75 2815.0 -340.875Q2799.75 -333.0 2791.375 -318.375Q2783.0 -303.75 2783 -283L2715.25 -310.0Q2715.25 -368.75 2741.125 -411.0Q2767.0 -453.25 2811.0 -476.125Q2855 -499 2910.5 -499.0Q2960.75 -499.0 3001.375 -475.5Q3042 -452 3066.0 -410.125Q3090.0 -368.25 3090.0 -310.75V0ZM3222.5 0.0V-283.0Q3222.5 -313.75 3203.75 -331.25Q3185.0 -348.75 3156.75 -348.75Q3137.5 -348.75 3122.125 -340.875Q3106.75 -333.0 3098.375 -318.375Q3090.0 -303.75 3090 -283L2988.25 -288.25Q2989.5 -353.75 3016.875 -400.875Q3044.25 -448.0 3091.625 -473.5Q3139 -499 3199 -499Q3256.25 -499.0 3300.875 -474.75Q3345.5 -450.5 3371.25 -405.25Q3397 -360 3397.0 -296.5V0Z';
function FieldPin() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <>
      <defs>
        <clipPath id={`${id}p`}>
          <path d={PIN} />
        </clipPath>
        <clipPath id={`${id}s`}>
          <rect width="64" height="34.2" />
        </clipPath>
      </defs>
      <path d={PIN} style={{ fill: 'var(--logo-pin)' }} />
      <circle cx="32" cy="34" r="10.5" clipPath={`url(#${id}s)`} style={{ fill: 'var(--logo-sun)' }} />
      <g clipPath={`url(#${id}p)`} fill="none" strokeWidth="2.7" strokeLinecap="round" style={{ stroke: 'var(--logo-rows)' }}>
        {ROWS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </>
  );
}

const toneClass = (tone: Tone) => (tone === 'reversed' ? 'logo-reversed' : '');

export function LogoMark({ size = 32, tone = 'auto', className = '' }: { size?: number; tone?: Tone; className?: string }) {
  return (
    <svg
      width={(size * 50.4) / 62}
      height={size}
      viewBox="6.8 1 50.4 62"
      aria-hidden="true"
      className={`${toneClass(tone)} ${className}`}
    >
      <FieldPin />
    </svg>
  );
}

export function Logo({ height = 36, tone = 'auto', className = '' }: { height?: number; tone?: Tone; className?: string }) {
  return (
    <svg
      width={(height * 499.988) / 149.895}
      height={height}
      viewBox="0 0 499.988 149.895"
      role="img"
      aria-label="i12farm"
      className={`${toneClass(tone)} ${className}`}
    >
      <g transform="translate(-1.98 9.82) scale(2.0351)">
        <FieldPin />
      </g>
      <g transform="translate(136.29 107.10) scale(0.1)">
        <path d={I12} style={{ fill: 'var(--logo-name)' }} />
        <path d={FARM} style={{ fill: 'var(--logo-farm)' }} />
      </g>
    </svg>
  );
}

export function PinSprout({ size = 24, tone = 'auto', className = '' }: { size?: number; tone?: Tone; className?: string }) {
  return (
    <svg
      width={(size * 50.4) / 62}
      height={size}
      viewBox="6.8 1 50.4 62"
      aria-hidden="true"
      className={`${toneClass(tone)} ${className}`}
    >
      <path d={PIN} style={{ fill: 'var(--logo-pin)' }} />
      <path d="M32 46V32" fill="none" strokeWidth="3.6" strokeLinecap="round" style={{ stroke: 'var(--logo-rows)' }} />
      <path d="M32.2 31.6C32.2 23.4 37.8 18.4 45.6 18.4 45.6 26.6 39.8 31.6 32.2 31.6Z" style={{ fill: 'var(--logo-sun)' }} />
      <path d="M31.8 35.2C31.8 28.7 27.3 24.6 21 24.6 21 31.1 25.7 35.2 31.8 35.2Z" style={{ fill: 'var(--logo-sun)' }} />
    </svg>
  );
}

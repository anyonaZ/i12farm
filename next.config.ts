import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Where the browser may load things from. Maps come from Google (when
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set), OpenFreeMap (vector) or OpenStreetMap
// (image fallback); photos from this site or the bucket in
// NEXT_PUBLIC_MEDIA_URL. Next.js needs inline scripts for its page data.
const media = process.env.NEXT_PUBLIC_MEDIA_URL ? new URL(process.env.NEXT_PUBLIC_MEDIA_URL).origin : '';
const tiles = 'https://tiles.openfreemap.org https://tile.openstreetmap.org';
// Google Maps, only when a key is set (Google's published allowlist for the Maps JavaScript API).
const google = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  ? {
      script: "'unsafe-eval' https://*.googleapis.com https://*.gstatic.com *.google.com https://*.ggpht.com *.googleusercontent.com blob:",
      img: 'https://*.googleapis.com https://*.gstatic.com *.google.com *.googleusercontent.com',
      connect: 'https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:',
      font: 'https://fonts.gstatic.com',
      style: 'https://fonts.googleapis.com',
      frame: 'frame-src *.google.com',
    }
  : { script: '', img: '', connect: '', font: '', style: '', frame: '' };
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${google.script}`.trim(),
  `style-src 'self' 'unsafe-inline' ${google.style}`.trim(),
  `img-src 'self' data: blob: ${tiles} ${media} ${google.img}`.trim(),
  `font-src 'self' data: ${google.font}`.trim(),
  `connect-src 'self' ${tiles} ${media} ${google.connect}`.trim(),
  "worker-src 'self' blob:",
  "child-src blob:",
  google.frame,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].filter(Boolean).join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
  // Browsers ignore HSTS over plain http, so it is safe to send everywhere.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // Node-only packages used by the server (database driver, mail).
  serverExternalPackages: ['postgres', 'nodemailer'],
  async headers() {
    return [
      // Development (next dev) needs eval for fast refresh, so the policy applies to builds only.
      ...(process.env.NODE_ENV === 'production' ? [{ source: '/:path*', headers: SECURITY_HEADERS }] : []),
      {
        // The service worker must never be cached, or updates won't reach phones.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

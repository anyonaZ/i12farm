// Renders the app icons from the logo SVG. Run: npm run icons
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const mark = (pad = 0) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${64 + 2 * pad} ${64 + 2 * pad}">
  <rect x="${-pad}" y="${-pad}" width="${64 + 2 * pad}" height="${64 + 2 * pad}" rx="${pad ? 0 : 16}" fill="#0A1F16"/>
  <path d="M32 10c-9.4 0-17 7.4-17 16.6C15 39 32 54 32 54s17-15 17-27.4C49 17.4 41.4 10 32 10z" fill="#10B981"/>
  <path d="M32 40V27" stroke="#0A1F16" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M32 29c0-6 4.2-9.6 10-9.6 0 6-4.4 9.6-10 9.6z" fill="#C6F36B"/>
  <path d="M32 32c0-4.8-3.4-7.8-8.2-7.8 0 4.8 3.6 7.8 8.2 7.8z" fill="#C6F36B"/>
</svg>`;

await mkdir('public/icons', { recursive: true });
const jobs = [
  ['public/icons/icon-192.png', 192, mark()],
  ['public/icons/icon-512.png', 512, mark()],
  ['public/icons/apple-touch-icon.png', 180, mark(6)],
  // Maskable: Android crops to a circle, so keep the pin inside the safe zone.
  ['public/icons/maskable-512.png', 512, mark(14)],
];
for (const [file, size, svg] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log('wrote', file);
}

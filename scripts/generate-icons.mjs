// Builds the app's icons from the brand kit (brand/logo/, see brand/BRAND-GUIDE.md).
// Run after changing a logo file: npm run icons
//   Field Pin app icon  home screen, Play Store, iPhone, link previews
//   Seed i              browser tab (favicon) and the Android notification shape
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const brand = (f) => readFile(new URL(`../brand/logo/${f}`, import.meta.url), 'utf8');
const png = (svg, size) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const appIcon = await brand('field-pin/i12farm-app-icon.svg');
const maskable = await brand('field-pin/i12farm-app-icon-maskable.svg');
const seed = await brand('seed-i/seed-i-favicon.svg');
const seedWhite = await brand('seed-i/seed-i-mono-white.svg');
// iPhones round the corners themselves, so give them the full square.
const appIconSquare = appIcon.replace('rx="15" ', '');

await mkdir('public/icons', { recursive: true });
const jobs = [
  ['public/icons/icon-192.png', appIcon, 192],
  ['public/icons/icon-512.png', appIcon, 512],
  ['public/icons/maskable-512.png', maskable, 512],
  ['public/icons/apple-touch-icon.png', appIconSquare, 180],
  ['public/icons/favicon-32.png', seed, 32],
  ['public/icons/favicon-48.png', seed, 48],
  // Android shows notification badges as a white shape on transparent.
  ['public/icons/badge-96.png', seedWhite, 96],
];
for (const [file, svg, size] of jobs) {
  await writeFile(file, await png(svg, size));
  console.log('wrote', file);
}
await writeFile('public/icons/favicon.svg', seed);
console.log('wrote public/icons/favicon.svg');

// favicon.ico for browsers that ask for it by name: 16, 32 and 48 px PNGs in one file.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(seed, s)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(s, at);
  header.writeUInt8(s, at + 1);
  header.writeUInt16LE(1, at + 4); // colour planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
await writeFile('public/favicon.ico', Buffer.concat([header, ...images]));
console.log('wrote public/favicon.ico');

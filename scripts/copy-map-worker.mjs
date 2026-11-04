// MapLibre GL 6 runs its tile parser in a Web Worker loaded from a separate
// file next to the library. Bundlers rename and move the library, so the
// worker is copied to public/ and the map is told where it is (FarmMap.tsx).
// Runs before `next dev` and `next build` (package.json pre-scripts).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'node_modules/maplibre-gl/package.json'), 'utf8'));
const out = join(root, 'public/vendor/maplibre');
mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'), join(out, `maplibre-gl-worker-${pkg.version}.mjs`));
console.log(`map worker → public/vendor/maplibre/maplibre-gl-worker-${pkg.version}.mjs`);

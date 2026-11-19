# i12farm brand

How to use the i12farm logo, colours, type and document templates: [BRAND-GUIDE.md](BRAND-GUIDE.md).
For partners and stakeholders, share the designed PDF: [i12farm-brand-guide.pdf](i12farm-brand-guide.pdf).

| Folder | What is in it |
| --- | --- |
| `logo/field-pin/` | The master logo. Lockup and mark in full colour, reversed, one colour Ink and one colour white; app icon (plus Android maskable). SVG and PNG |
| `logo/seed-i/` | Small-size monogram: favicon (32, 48, 180 px), white notification shape, Ink version |
| `logo/pin-sprout/` | In-app "pin your farm" illustration, light and dark |
| `logo/harvest-seal/` | Emblem for certificates and "Verified farm" stickers |
| `tokens/` | Brand colours as `colors.json` and `colors.css` (same values as `src/app/globals.css`) |
| `templates/` | Letterhead and proposal page as A4 PDF and PNG previews |
| `templates/report-covers/` | Six report covers, one per report type, as A4 PDF and PNG |

The wordmark and seal text are outlined shapes, so the SVGs look the same on any computer without the fonts installed.

**In the app:** `src/components/Logo.tsx` draws the Field Pin lockup, mark and Pin Sprout from these files (full colour on light screens, reversed in dark mode). `npm run icons` rebuilds the app icons, favicon and notification badge from `logo/`, so run it after changing a logo file.

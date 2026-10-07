# i12farm

Every Kenyan farm, pinned and discoverable. A mobile-first web app (installable
on Android from Chrome) built on Next.js and Supabase, delivered in phases.
This repository is **Phase 0: Foundations**.

## What Phase 0 contains

| Area | What's here |
| --- | --- |
| App shell | Next.js 16 (App Router, TypeScript), Tailwind CSS 4 design tokens, bottom navigation, Explore / Inbox / My Farm screens |
| Languages | English and Kiswahili from day one (`messages/en.json`, `messages/sw.json`); choice saved in a cookie and on the profile |
| Installable app | Web manifest, icons, and a hand-written service worker (`public/sw.js`): offline page, cached shell, cached farm photos; personal pages are never cached |
| Sign-in | Supabase Auth with Google and email magic link (`/sign-in`, `/auth/callback`, `/auth/sign-out`) |
| Database | The full Phase 1 schema in `supabase/migrations/`: profiles, farms, exact and public locations, photos, listings, append-only price history, contact events, event log, daily rollups |
| Security | Row-level security on every table, column-level grants, storage policies. 29 automated tests in `supabase/tests/security_test.sql` |
| Reference data | All 47 counties with official codes, all sub-counties for the five pilot counties (Homa Bay, Kisumu, Migori, Kiambu, Nairobi), 16 farm categories and 38 products, all bilingual |
| Analytics | First-party event tracker (`src/lib/analytics`) → `/api/events` → `public.events`, rolled up nightly into `events_daily` |
| Ops | GitHub Actions: CI (typecheck, build, database tests on real PostGIS) and an encrypted nightly backup |

## Run it locally

Requirements: Node 20.9+, Docker (for local Supabase).

```bash
npm install
npx supabase start            # local Postgres + PostGIS, Auth, Storage; applies migrations + seed
cp .env.example .env.local    # paste the API URL and publishable/anon key that `supabase start` prints
npm run dev                   # http://localhost:3000
```

The seed adds two dev accounts and eight sample farms around Homa Bay and
Kisumu. Sign in with email: local Supabase catches the magic link in its mail
viewer at http://127.0.0.1:54324.

Test the installable app on a phone with `npm run build && npm start` and open
it from Chrome on Android over your local network (or a tunnel). The service
worker only registers in production builds.

## Test the database

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:test
```

CI runs the same script against a `postgis/postgis` container on every push.
`scripts/test-db.sh --standin` runs it on a plain Postgres 16 with a small
PostGIS stand-in, for machines where PostGIS can't be installed.

## Deploy (free tier)

1. Create a Supabase project (region closest to Kenya). Enable `pg_cron` under
   Database → Extensions, then run `npx supabase link` and `npx supabase db push`.
2. Auth → Providers: enable Google (OAuth client from Google Cloud) and Email.
   Auth → URL configuration: add `https://<your-domain>/auth/callback`.
3. Import the project into Vercel, set the variables from `.env.example`.
   Vercel's free plan is for non-commercial use; move to Cloudflare or a small
   VPS before charging any fee (see the plan doc).
4. Add repository secrets `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE` to turn on
   nightly backups.

## Load all wards

Sub-counties for the five pilot counties ship in the migrations; `counties.is_pilot` marks them. For national coverage, export
the IEBC ward list to CSV with columns `county_code, sub_county, ward_code, ward`
and run:

```bash
node scripts/import-admin-units.mjs wards.csv > supabase/migrations/20261008000000_admin_units.sql
npx supabase db push
```

## How the code is organised

- `src/app` – routes (pages, API, auth callbacks)
- `src/domains` – business domains; each owns its tables (see `src/domains/README.md`)
- `src/lib` – Supabase clients, analytics, env
- `supabase/migrations` – schema, security, reference data (source of truth)
- `supabase/tests` – database tests and the Supabase stand-ins they use

## Data rules worth knowing

- **Exact farm coordinates** live in `farm_locations`, readable only by the
  farm's owner, its field agent and admins. The map reads `farms.public_location`,
  which a trigger keeps exact, snapped to a ~1 km grid, or empty, per the
  farmer's choice. Clients cannot write it.
- **History is never overwritten.** Every listing price, quantity or status
  change appends a row to `price_history`; every "Call" or "WhatsApp" tap is a
  `contact_events` row.
- **Events** must use a name from `src/lib/analytics/events.ts`. Renaming an
  event breaks year-on-year analysis, so add new names instead.
- **Roles** (`farmer`, `buyer`, `provider`, `agent`, `partner`, `admin`) can
  only be granted by an admin. Give the first admin their role in the SQL
  editor: `update profiles set roles = roles || '{admin}' where id = '<user id>';`

## Colours

| Token | Hex | Use |
| --- | --- | --- |
| `sprout` | #12B76A | Pins, icons, active states, large accents |
| `sprout-deep` | #067647 | Filled buttons and links (white text passes WCAG AA at 5.7:1) |
| `forest` | #053B2B | Text and dark surfaces |
| `lime` | #B6F04A | Highlights and badges |
| `mint` | #F3FBF6 | Page background |
| `amber` | #F5A524 | Prices and warnings |
| `soil` | #5B6B63 | Secondary text |

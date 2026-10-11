# i12farm handoff

Last updated: 11 October 2026. Read this first when continuing in a new chat.

## 1. What i12farm is

A mobile-first web app (installable on Android from Chrome) that makes every
Kenyan farmer, however small, visible on a map, the way Airbnb did for small
guesthouses. Buyers find produce, livestock, vets and training. Farmers get
buyers and services. Government and NGOs reach farmers by county and farm
type. Every action is recorded with time and county, because that data is the
long-term asset.

- **Owner:** Zacc (ogadazaddock@gmail.com). Works on one laptop (Lenovo T470s, Arch Linux).
- **Development plan and architecture:** https://claude.ai/code/artifact/c72e9879-fd6e-49e0-973c-bf92745cadae
- **Clickable prototype (no backend needed):** https://claude.ai/artifact/Lm64B1Bka4m8S3s3GXcx3u, source in `prototype/index.html`

## 2. How Zacc wants the work done

- Build in phases. Never everything at once. Keep each phase shippable.
- Be careful with resources: free and open-source tools first, paid services only when a metric demands it.
- The uploaded pitch deck, concept doc and wireframes give context only. Do not reuse their colours or designs.
- Look: fresh, bright green that says "new technology for farmers". Inspiration comes from Airbnb (discovery, trust) and Bolt (map-first, one big action).
- Record everything for later analysis. Never overwrite history.
- Wants a working prototype he can click through, not more questions.

## 3. Decisions already made

| Decision | Value |
| --- | --- |
| Pilot counties | Homa Bay (43), Migori (44), Kisumu (42), Kiambu (22), Nairobi (47). Stored as `counties.is_pilot` |
| Phase 1 target | 100 farms in the pilot counties. Zacc said "they will enroll" (message was cut off); built as field-agent enrolment with a progress bar |
| Domain | Undecided. `i12farm&market.com` in the deck was only a placeholder |
| Languages | English and Kiswahili from day one |
| Sign-in | Google and email magic link now; phone OTP in Phase 2 (costs per SMS) |
| Location privacy | Exact point is private (`farm_locations`). The public pin is exact, snapped to ~1 km (default), or hidden, as the farmer chooses |
| Hosting | Vercel Hobby is fine for the pilot, but it is non-commercial only. Move to Cloudflare or a small VPS before charging any fee |
| Database | Supabase free tier (500 MB DB, 1 GB files). Free projects pause after a week of inactivity; the nightly backup workflow also keeps the project active |

Still open, needed by Phase 2: commission rate (deck says 10%, concept doc says 5–10%), premium listing price, annual subscription.

## 4. Status

| Phase | State |
| --- | --- |
| 0 Foundations | Done: app shell, i18n, PWA, auth, schema, RLS, reference data, events, CI, backups |
| 1 Be seen | Code written; database layer tested; **the app has never been built or run** (see 5) |
| 2 Trade | Not started: orders, M-Pesa STK Push, reviews, chat, phone sign-in, bookings |
| 3 Reach | Not started: on-demand vet requests, USSD/SMS, partner broadcast portal |
| 4 Insight | Not started |

## 5. Do this first in the new chat

The previous sandbox blocked npm, pip, apt and map tiles, so nothing below has
been run yet. The database SQL was tested on Postgres 16 with a small PostGIS
stand-in (40 checks pass); CI runs the same tests on real PostGIS.

1. `npm install`, then `npm run typecheck` and `npm run build`. Fix whatever breaks. Likely spots:
   - `src/components/map/FarmMap.tsx`: MapLibre v5 types (`getClusterExpansionZoom` returns a Promise in v5; `attributionControl: { compact: true }`).
   - The glyph font name `'Noto Sans Bold'` in the cluster-count layer must exist in the OpenFreeMap Positron style; if counts don't render, check the style's `glyphs` and font stack.
   - next-intl v4 plural messages (`explore.inArea` uses ICU plurals).
   - Next 16 renamed middleware to `src/proxy.ts`; if the installed Next is 15, rename it back to `middleware.ts` and the export to `middleware`.
2. `npx supabase start` (Docker), copy `.env.example` to `.env.local`, `npm run dev`. The seed loads 35 farms across the pilot counties.
3. Make your account a field agent in the Supabase SQL editor:
   `update profiles set roles = roles || '{agent}' where id = '<your user id>';`
4. Walk the flows on a phone: Explore → farm page → Call/WhatsApp; Pin your farm; My Farm price edit; agent enrolment.
5. Run `npm run db:test` against the local database (real PostGIS).

## 6. Repository map

```
prototype/index.html          clickable demo (canvas map, sample data, localStorage)
src/app/page.tsx              Explore (server) → components/explore/ExploreClient.tsx
src/app/f/[slug]/page.tsx     public farm page (+ components/farm/*)
src/app/my-farm/page.tsx      dashboard: farms, stats, prices, saved, agent progress
src/app/my-farm/new/          PinWizard.tsx (six-step pin / enrol flow)
src/app/sign-in, auth/*       Google + email link, callback, sign-out
src/app/api/events/route.ts   first-party analytics ingest
src/components/map/FarmMap.tsx  MapLibre wrapper: clusters, select, pin-drop mode
src/domains/farms/            queries.ts (server reads), actions.ts (server actions), types.ts
src/domains/reference/        counties, sub-counties, categories, products
src/lib/                      supabase clients, analytics, phone, images, storage, format
messages/en.json, sw.json     all UI text (keys must match in both)
supabase/migrations/          schema, RLS, reference data, Phase 1 functions (source of truth)
supabase/seed.sql             test seed (8 farms; the tests depend on these counts)
supabase/seed_demo.sql        27 more demo farms for local development
supabase/tests/               security_test.sql + Supabase/PostGIS stand-ins
scripts/test-db.sh            applies migrations + seeds, runs tests (--standin for no PostGIS)
.github/workflows/            ci.yml (build + DB tests), backup.yml (encrypted nightly pg_dump)
```

Code is grouped by domain (`src/domains/README.md`). One domain never queries another domain's tables directly.

## 7. Rules the data model enforces

- RLS on every table; column grants stop users editing roles, verification or `public_location`.
- `farms.public_location` is derived by trigger from `farm_locations` and `visibility`. Never write it.
- `price_history` gets a row on every price, quantity, unit or status change (trigger). Append-only.
- `contact_events` records every Call / WhatsApp / Directions / Share tap, including from signed-out buyers.
- `events` names must be in `src/lib/analytics/events.ts`. Add names; never rename them.
- `create_farm(payload)` creates farm, exact pin and listings in one transaction. With `for_farmer: true`, only agents may use it, and the farm has no owner until the farmer claims it.
- Counties, sub-counties and wards use official codes, so the data joins with government statistics.

## 8. Known gaps in Phase 1

- Adding or removing photos after a farm is created (upload exists only in the wizard).
- A visibility toggle on My Farm (the `setFarmVisibility` action exists; no UI yet).
- Admin screens: verifying farms, granting roles and suspending are SQL-only for now.
- Farmers claiming an agent-enrolled farm (needs phone sign-in, Phase 2).
- National ward list: run `scripts/import-admin-units.mjs` with the IEBC CSV.
- No rate limiting on `/api/events` or contact inserts yet.
- A native speaker should review the Kiswahili text.
- Map tiles are not cached for offline use; only pages and farm photos are.

## 9. Next phase (2 · Trade), in order

1. Phone OTP sign-in (Supabase + Africa's Talking or Twilio), so farmers without email can own their farms.
2. Orders and order status history; cart on the farm page.
3. M-Pesa STK Push through Daraja (`daraja-kit`), with a callback Edge Function and the commission recorded per order.
4. Reviews after a completed order.
5. In-app chat (Supabase Realtime) to fill the Inbox tab.
6. Experience bookings (training, tours), premium listings, first Metabase dashboards.

Gate to Phase 3: paid orders settle end to end with commission recorded.

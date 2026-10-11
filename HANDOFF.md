# i12farm handoff

Last updated: 11 October 2026. Read this first when continuing in a new chat.

## 1. What i12farm is

A mobile-first web app (installable on Android from Chrome) that makes every
Kenyan farmer, however small, visible on a map, the way Airbnb did for small
guesthouses, and now lets buyers order and pay with M-Pesa. Buyers find
produce, livestock, vets and training. Farmers get buyers and services.
Government and NGOs reach farmers by county and farm type. Every action is
recorded with time and county, because that data is the long-term asset.

- **Owner:** Zacc (ogadazaddock@gmail.com). Works on one laptop (Lenovo T470s, Arch Linux).
- **Development plan and architecture:** https://claude.ai/code/artifact/c72e9879-fd6e-49e0-973c-bf92745cadae (written for the Supabase design; sections on auth and storage are superseded by this file)
- **Clickable prototype (no backend needed):** https://claude.ai/artifact/Lm64B1Bka4m8S3s3GXcx3u, source in `prototype/index.html`

## 2. How Zacc wants the work done

- Build in phases. Never everything at once. Keep each phase shippable.
- Be careful with resources: free and open-source tools first, paid services only when a metric demands it.
- **No Supabase or similar vendor backend** (decided 11 Oct 2026): our own sign-in, user management and storage on plain Postgres.
- The uploaded pitch deck, concept doc and wireframes give context only. Do not reuse their colours or designs.
- Look: fresh, bright green that says "new technology for farmers". Inspiration: Airbnb (discovery, trust) and Bolt (map-first, one big action).
- Record everything for later analysis. Never overwrite history.
- Wants a working prototype he can click through, not more questions.

## 3. Decisions already made

| Decision | Value |
| --- | --- |
| Pilot counties | Homa Bay (43), Migori (44), Kisumu (42), Kiambu (22), Nairobi (47). Stored as `counties.is_pilot` |
| Phase 1 target | 100 farms in the pilot counties, enrolled by field agents (progress bar on My Farm) |
| Domain | Undecided |
| Languages | English and Kiswahili from day one (426 strings each; a native speaker should review) |
| Backend | Next.js server + PostgreSQL 15+ with PostGIS. No Supabase. RLS policies unchanged; `withUser()` sets the role per transaction |
| Sign-in | Phone or email + password (scrypt). Google optional. Email link for forgotten passwords; admins issue one-time links for farmers without email. **No SMS OTP** (costs money); farm ownership is proven with agent-issued claim codes |
| Sessions | Random token in an httpOnly cookie, SHA-256 in `auth.sessions`; 30 days idle, 180 days max; revoked rows are kept |
| Photos | Local disk (`/media`) or any S3-compatible bucket (Cloudflare R2). Shrunk to WebP on the phone first |
| Payments | M-Pesa STK Push via Daraja, hand-written client. Money is held until the buyer confirms receipt, then owed to the farmer; payouts and refunds recorded by an admin (manual M-Pesa for now) |
| Commission | 10% default in `platform_settings` (still an open business decision: deck says 10%, concept doc 5–10%). Each order keeps the rate it was placed with |
| Location privacy | Exact point is private (`farm_locations`). Public pin is exact, snapped to ~1 km (default), or hidden |
| Seed farm | Homa Organica, Benedict Kotonya, Lang'ata (Nairobi): pigs and racing pigeons, `/f/homa-organica`. Phone, prices and stock are placeholders until Benedict confirms |

Still open: commission rate, premium listing price, annual subscription, domain, who sends payouts (manual vs. B2C API).

## 4. Status

| Phase | State |
| --- | --- |
| 0 Foundations | Done |
| 1 Be seen | Done and now actually built and run: `npm run build` clean, flows walked in a phone-sized browser |
| 2 Trade | **Built (core).** Own accounts, claim codes, cart, orders, M-Pesa (simulate + Daraja), ledger, reviews, messaging, admin. Not yet: experience bookings, premium listings, Metabase, automatic payouts |
| 3 Reach | Not started: on-demand vet requests, USSD/SMS, partner broadcast portal |
| 4 Insight | Not started |

Verified on 11 Oct 2026 in the build sandbox: 70 database checks on real
PostGIS (`npm run db:test`), typecheck, production build, and a browser
walkthrough at 390×844: sign up, message a farm, add to cart, checkout,
simulated M-Pesa payment, agent accepts and marks ready, buyer confirms and
reviews, rating shows on the farm page, agent issues a claim code and a new
farmer account claims Homa Organica, admin records the payout, email-link
sign-in, pin wizard with photo upload, password change, Kiswahili. Not
verified here: real Daraja sandbox calls and Google sign-in (the sandbox has
no internet access to Safaricom or Google), and map tiles (blocked in the
sandbox; Explore now lists farms even without tiles).

## 5. Do this first in the new chat

1. On the laptop: install Postgres + PostGIS (README), `npm install`, `npm run db:reset`, `npm run dev`. Sign in with the dev accounts in the README.
2. Get Daraja sandbox keys and test one real STK push through a tunnel (README → M-Pesa).
3. Confirm Homa Organica's real phone, prices and stock with Benedict; update in My Farm (or have Benedict claim the farm himself with a claim code).
4. Pick hosting (section 9) and deploy the pilot.

## 6. Repository map

```
prototype/index.html               clickable demo (canvas map, sample data, localStorage)
src/app/page.tsx                   Explore → components/explore/ExploreClient.tsx
src/app/f/[slug]/page.tsx          farm page: cart steppers, reviews, Message, contact bar
src/app/checkout/                  cart re-pricing, pickup/delivery, M-Pesa number
src/app/orders/                    order list, order page (payment panel, farm/buyer actions, review)
src/app/inbox/                     conversations, thread (polling), /inbox/order/<number>
src/app/my-farm/                   dashboard, PinWizard, FarmTools (claim code, photos, stock)
src/app/account/                   profile, sign-in details, password, devices, claim a farm
src/app/admin/                     people, farms to verify, payouts, refunds, commission
src/app/sign-in, auth/*            sign-in/up forms, Google start/callback, one-time link, sign-out
src/app/api/                       farms (map box), farms/search, contact, events, farms/[id]/photos,
                                   orders/[number] (status poll), conversations/[id]/messages,
                                   mpesa/callback/[secret]
src/app/media/[...path]            serves locally stored photos
src/domains/                       farms, reference, identity, orders (+payments.ts), messaging, admin
src/lib/db.ts                      Postgres pool, withUser() (RLS context), dbMessage()
src/lib/auth/                      password (scrypt), session, viewer, accounts, google
src/lib/mpesa.ts                   Daraja client: token, STK push/query, callback parsing, simulate
src/lib/media.ts, media-url.ts     photo storage drivers (local / S3), public URLs
src/lib/cart.ts                    one-farm cart in localStorage
messages/en.json, sw.json          all UI text (keys must match in both)
db/migrations/                     schema source of truth (platform → foundation → … → trade)
db/seed.sql, seed_demo.sql         dev accounts + 8 test farms; 28 demo farms incl. Homa Organica
db/tests/                          security_test.sql, trade_test.sql (+ PostGIS stand-in)
scripts/db.mjs                     migrate / status / seed / reset
scripts/test-db.sh                 fresh database, all migrations, seed, both test files
.github/workflows/                 ci.yml (build + DB tests), backup.yml (rollup + encrypted dump)
```

## 7. Rules the data model enforces

- RLS on every table; column grants stop users editing roles, verification or `public_location`.
- The `auth` schema (users, password hashes, sessions, tokens, sign-in attempts, audit log) is invisible to the request roles.
- `farms.public_location` is derived by trigger. Never write it.
- `price_history` gets a row on every price, quantity, unit or status change. Append-only.
- `contact_events` records every Call / WhatsApp / Directions / Share tap.
- `events` names must be in `src/lib/analytics/events.ts`. Add names; never rename them.
- Orders: only `place_order()` creates them (prices from live listings), only `record_payment_result()` marks them paid (server-only, idempotent), only `set_order_status()` moves them (buyer cancels unpaid / confirms receipt; farm accepts, declines, marks ready; admin overrides).
- `order_status_history`, `ledger_entries`, `messages`, `platform_settings_history`, `auth.audit_log`, `auth.sign_in_attempts` are append-only.
- Admin actions are SECURITY DEFINER functions that check the admin role and write the audit log.
- Counties, sub-counties and wards use official codes.

## 8. Known gaps

- Payouts to farmers and refunds are manual (admin sends M-Pesa, records the reference). B2C API automation later.
- No SMS or push notifications: farms see new orders on My Farm / Orders / Inbox only. Add Africa's Talking SMS for "new paid order" in Phase 3.
- A buyer who never taps "I received it" leaves money held; an admin can complete the order. Auto-complete after N days is not built.
- Chat is polling, not push (fine for the pilot; cheap on any host).
- Rate limiting covers sign-in, email links and claim codes; `/api/events`, `/api/contact` and messages have none yet.
- A Kiswahili native speaker should review all text.
- Map tiles are not cached offline; pages and photos are.
- Experience bookings, premium listings and Metabase dashboards (Phase 2b).
- National ward list: run `scripts/import-admin-units.mjs` with the IEBC CSV.
- Migrations were edited in place on 11 Oct 2026 (nothing had been deployed). From the first deploy on, only add new migration files.

## 9. Hosting (researched 11 Oct 2026; free tiers change, check before signing up)

The app needs three things: a Node server (Next.js), Postgres with PostGIS,
and somewhere for photos. Two free setups fit:

**A. Pilot demo, zero server admin: Vercel Hobby + Neon Free + Cloudflare R2**
- Vercel Hobby: free, but restricted to **personal, non-commercial use**. Fine for a demo; not once real orders carry a commission.
- Neon Free: 1 GB Postgres per project, PostGIS included, 100 CU-hours per project per month, sleeps after 5 minutes idle (first request after that is slower), 5 GB egress.
- Cloudflare R2: 10 GB storage, 1 M writes and 10 M reads a month, no egress fees.
- Settings: Neon pooled URL with `DATABASE_PREPARE=false` and `DATABASE_POOL_MAX=1`; `MEDIA_DRIVER=s3` + R2 keys + `NEXT_PUBLIC_MEDIA_URL`.

**B. Real pilot with M-Pesa commission: Oracle Cloud Always Free VM (recommended before charging)**
- Always Free Arm (A1) allowance is now 2 OCPU and 12 GB RAM, 200 GB block storage, 10 TB outbound a month, no commercial-use restriction. Johannesburg is the closest region to Kenya.
- One VM runs Postgres + PostGIS, the Node app (`npm run build && npm start` under systemd) and Caddy for automatic HTTPS; photos stay on disk (`MEDIA_DIR`).
- Caveat: Oracle may reclaim Always Free instances that sit idle for 7 days (CPU, network and memory all under 20%). Keep the nightly backup workflow, and consider upgrading the account to Pay As You Go (stays free within the limits) to avoid reclamation.
- Caveat: you run the server yourself (updates, backups). The nightly GitHub workflow covers database backups.

Not recommended: Render's free tier (web service sleeps after 15 minutes idle; free Postgres is deleted after 30 days + 14-day grace), and Koyeb (no free compute instance any more, only a small free Postgres).

## 10. Next phase

**Phase 2b · Trade, finished**
1. Real Daraja sandbox test, then "Go Live" with Safaricom (paybill or till).
2. Auto-complete orders N days after "ready" if the buyer is silent; reminders.
3. B2C payouts (or a weekly payout batch screen) instead of manual references.
4. Experience bookings (training, tours) using the same order + payment flow.
5. Premium listings; first Metabase (or SQL) dashboards on `events_daily`, orders and ledger.

Gate to Phase 3: real (non-simulated) paid orders settle end to end with commission and payout recorded.

**Phase 3 · Reach:** SMS for new orders and payouts (Africa's Talking), USSD menu for feature phones, on-demand vet requests, partner broadcast portal by county and farm type.

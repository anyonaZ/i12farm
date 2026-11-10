# i12farm

Every Kenyan farm, pinned, discoverable and able to sell. A mobile-first web
app (installable on Android from Chrome) built on Next.js and plain
PostgreSQL + PostGIS, delivered in phases. Phases 0 to 4 (plus the 3.5 hardening pass) are built. SMS and USSD were removed on 10 Nov 2026. See
`HANDOFF.md` for the current state, decisions and what comes next.

No vendor backend: the app talks to Postgres directly and handles sign-in,
sessions and photo storage itself. Any Postgres 15+ with PostGIS works
(your laptop, a VPS, Neon, Aiven).

## What's in it

| Area | What's here |
| --- | --- |
| Explore | Full-screen map: Google Maps when a key is set, otherwise (or if Google fails) MapLibre on free OpenFreeMap tiles; clustered pins, category chips, county picker, search in English and Kiswahili, ratings on cards |
| Farm page | `/f/<slug>`: photos, verified badge, rating and reviews, products with **Add to cart**, Message, Call / WhatsApp / Directions / Share (every tap recorded) |
| Accounts | Phone number **or** email + password, Google (optional), one-time email sign-in link, account page, signed-in devices, sign out elsewhere |
| Pin your farm | Six-step wizard; photos shrink on the phone (to ~200 KB WebP) before upload. Field agents enrol farmers who have no account |
| Claiming | An agent gets an 8-digit claim code; the farmer signs up with their phone and enters it to own the farm. No SMS cost |
| Orders | One-farm cart kept on the phone, checkout (pickup or delivery), M-Pesa STK Push, order status history, farm accepts / declines / marks ready, buyer confirms receipt |
| Money | Commission snapshotted per order (10% by default, admin can change), append-only ledger: payment, commission, farmer share held until completion, payouts and refunds recorded by an admin |
| Bookings | Training and farm tours: **Book**, choose a visit date and morning/afternoon, pay by M-Pesa; the farm accepts the date |
| Featured | Farms pay (7 or 30 days, prices are a setting) to appear first on the map and in search with a Featured badge |
| Upkeep | Ready orders complete after 3 days, unpaid orders cancel after 48 h, silent payment prompts expire; nightly, or from Admin → Settings |
| Reviews | One per completed order, public on the farm page and map cards |
| Inbox | Buyer ↔ farm conversations, order updates posted into the thread, unread counts; polls every 5 s while open |
| My Farm | Views, calls, WhatsApp taps, earnings (held, due, paid out), price and stock editing, photos, claim codes, pilot progress for agents |
| Admin | `/admin`: Insights (KPIs, weekly paid value, funnel, counties, top products, CSV exports), people (roles, suspend, one-time sign-in links), farms to verify, money (payouts and refunds, payout CSV out and results CSV in), settings (commission, upkeep timings, featured plans) |
| Vets | `/vets`: farmers ask for a vet (animal, problem, county, how soon); vet-service farms in that county see it in their app (Vets tab badge), the first to accept gets the farmer's number and the farmer gets the vet's. Up to 3 open requests per person; requests expire after 48 h |
| Prices | `/prices` (public): weekly median price per product for each county or all of Kenya, 12-week trend, range across farms, and what buyers searched for but did not find. Farm pages show "County median KES …" beside each price |
| Insights | `/partner` for partner organisations and admins: farms by type, what is on sale and at what median, orders and value, buyer contacts, vet requests by animal, most searched and not found, for 30 days / 90 days / 1 year. Groups smaller than 3 are hidden |
| Editing | Farms and agents edit a published farm (details, types, phone, pin, visibility), add, pause or remove products, and pause the whole farm. Agents with many farms get a searchable list |
| Privacy | `/privacy` and `/terms` (drafts for legal review), Account → Download my data and Delete my account |
| Analytics | First-party events (`src/lib/analytics`) into `public.events`, rolled up nightly into `events_daily` |

## Run it locally (Arch Linux)

Requirements: Node 20.9+, PostgreSQL 15+ with PostGIS.

```bash
# 1. Postgres + PostGIS (once)
sudo pacman -S postgresql postgis
sudo -iu postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
sudo -iu postgres psql -c "alter user postgres password 'postgres'" -c "create database i12farm"
#    or with Docker:  docker run -d --name i12db -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=i12farm postgis/postgis:16-3.4

# 2. App
npm install
cp .env.example .env.local      # DATABASE_URL is the only required value
npm run db:reset                # creates schema, loads 36 demo farms and dev accounts
npm run dev                     # http://localhost:3000
```

Dev accounts (password `i12farm-dev` for all):

| Who | Sign in with | Can do |
| --- | --- | --- |
| Field agent | `0700 000 001` | Manages most demo farms (including Homa Organica), enrols farms, issues claim codes, handles their orders |
| Farmer | `0700 000 002` | Owns Lakeview Dairy |
| Buyer | `0700 000 003` | Orders and reviews |
| Partner | `0700 000 004` | Homa Bay County Extension: county insights at `/partner` |
| Admin | `admin@dev.i12farm.local` | Everything under `/admin` |

**Try a full sale:** sign in as the buyer, open `/f/homa-organica`, add racing
pigeons, check out. With `MPESA_ENV=simulate` (the default without keys) the
order page shows **Simulate: pay**. Then sign in as the agent → Orders →
accept → mark ready; back as the buyer → I received it → review. The admin
sees the payout due under `/admin?tab=money`.

**Try a booking:** as the buyer, open Lakeview Dairy, tap **Book** on the
training, pick a date. **Try featuring:** as the agent, My Farm → Homa
Organica → Feature this farm → Simulate: pay; Homa now leads Explore.

In `npm run dev`, email sign-in links appear on screen; in production they
are emailed (or printed to the server log if `SMTP_URL` is unset).

## Database

```bash
npm run db:migrate      # apply new files in db/migrations (each once, in order)
npm run db:status       # applied / pending
npm run db:seed         # dev data (refuses to run against hosted databases)
npm run db:reset        # drop and rebuild (development only)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run db:test   # 84 schema/security/trade checks
```

Security lives in the database: every user-facing query runs inside
`withUser()` (`src/lib/db.ts`), which switches to the `anon` or
`authenticated` role and sets `app.user_id` for that transaction only, so the
row-level security policies apply. Money moves only through database
functions (`place_order`, `record_payment_result`, `set_order_status`), and
the ledger is append-only.

## M-Pesa

`MPESA_ENV=simulate` needs nothing. For the Daraja sandbox, create an app at
developer.safaricom.co.ke, then set `MPESA_ENV=sandbox`, the consumer key and
secret, `MPESA_PASSKEY` (sandbox shortcode 174379), and
`MPESA_CALLBACK_SECRET` (`openssl rand -hex 24`). The callback URL must be
public HTTPS; locally use a tunnel (`cloudflared tunnel --url localhost:3000`)
and set `MPESA_CALLBACK_BASE_URL` to it. Callbacks are confirmed with an STK
status query before an order is marked paid.

## Maps (Google Maps, with a free fallback)

Without a key the app uses MapLibre on free OpenFreeMap tiles (and a Leaflet
image map on phones without WebGL). To use Google Maps:

1. Google Cloud console → create a project → attach a billing account
   (required even for the free usage).
2. APIs & Services → enable **Maps JavaScript API**.
3. Credentials → Create API key → restrict it to **Websites** (your domain and
   `http://localhost:3000/*`) and to the Maps JavaScript API only.
4. Maps → Map management → Create map ID (JavaScript, Vector). Without one,
   Google's `DEMO_MAP_ID` is used, which is fine for testing.
5. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`,
   then **rebuild** (both are baked into the browser bundle). The security
   headers allow Google's domains only when the key is set.

If the key is refused, billing is off or Google doesn't load within 8 s, the
map quietly switches to the free one. Pricing at the time of writing: 10,000
map loads a month free, then about USD 7 per 1,000 (Dynamic Maps SKU); check
Google's pricing page and set a budget alert.

## Prices and insights (Phase 4)

All in SQL (`db/migrations/20261110000200_insight.sql`), read-only:

- `price_index(county, weeks, product)`: each listing's price in effect at the
  end of each week (from `price_history`), then the median per product and unit
  across published farms; goods only, not services.
- `price_benchmarks(farm)`: today's county median for each of a farm's listings
  (Kenya median when fewer than 3 farms in the county sell it).
- `search_log` + `log_search()`: every search from Explore, with the county
  being looked at and the number of results. No user id, no IP; the device id
  is hashed. Kept 180 days (setting `search_log_days`), at most 60 an hour per device.
- `search_demand()` / `unmet_demand()`: finished searches only (half-typed words
  dropped), no long numbers, at least 3 different devices. The public list keeps
  only everyday farm words; partners see every term.
- `county_insight(county, days)`: the partner dashboard, for partner and admin
  roles only. Groups smaller than `insight_min_count` (3) are hidden.

The demo seed adds 12 weeks of price history, searches, completed orders from a
demo-only buyer, vet requests and contact taps so these pages have content.

## Deploy

See "Hosting" in `HANDOFF.md` for the recommended free setups. Whatever the host:

1. Create the database (with PostGIS), set `DATABASE_URL`, run `npm run db:migrate`, then **restart the app** (after every migration).
   Do not set `DEMO_MODE` on the real pilot: without it, a production build refuses simulated payments and open callback URLs.
2. Set `NEXT_PUBLIC_SITE_URL` to the https address (cookies become Secure).
3. On hosts without a lasting disk, set the `S3_*` variables (Cloudflare R2) for photos.
4. Make yourself admin once:
   `psql "$DATABASE_URL" -c "update profiles set roles = roles || '{admin}' where id = (select id from auth.users where phone = '2547XXXXXXXX')"`
5. Add repository secrets `DATABASE_URL` and `BACKUP_PASSPHRASE` for the nightly backup, rollup and order-upkeep workflow (or set `CRON_SECRET` and call `/api/cron/maintenance` hourly from any scheduler).

## Load all wards

Sub-counties for the five pilot counties ship in the migrations. For national
coverage, export the IEBC ward list to CSV (`county_code, sub_county, ward_code, ward`) and run:

```bash
node scripts/import-admin-units.mjs wards.csv > db/migrations/<timestamp>_admin_units.sql
npm run db:migrate
```

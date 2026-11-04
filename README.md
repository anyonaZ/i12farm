# i12farm

Every Kenyan farm, pinned, discoverable and able to sell. A mobile-first web
app (installable on Android from Chrome) built on Next.js and plain
PostgreSQL + PostGIS, delivered in phases. Phases 0 to 3, plus the 3.5 hardening pass, are built. See
`HANDOFF.md` for the current state, decisions and what comes next.

No vendor backend: the app talks to Postgres directly and handles sign-in,
sessions and photo storage itself. Any Postgres 15+ with PostGIS works
(your laptop, a VPS, Neon, Aiven).

## What's in it

| Area | What's here |
| --- | --- |
| Explore | Full-screen MapLibre map on free OpenFreeMap tiles, clustered pins, category chips, county picker, search in English and Kiswahili, ratings on cards |
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
| Vets | `/vets`: farmers ask for a vet (animal, problem, county, how soon); vet-service farms in that county get an SMS, the first to accept gets the farmer's number and the farmer gets the vet's. Requests expire after 48 h |
| SMS | Africa's Talking: new paid order to the farm, ready/declined to the buyer, payout and refund receipts, vet alerts. Every SMS goes through an outbox table; **simulate mode** (default) stores the text without sending. STOP / ACHA opts a phone out of partner news |
| USSD | Feature-phone menu: farmers see and accept orders, mark them ready, change prices and stock, request a vet or take vet requests, switch SMS news and language. Admin → Reach has a simulator |
| Partners | `/partner`: county offices, cooperatives and NGOs write one SMS in English and Kiswahili, pick counties and farm types, see the audience and cost, and submit it; an admin approves it in Admin → Reach; delivery numbers come back to the partner |
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
| Partner | `0700 000 004` | Homa Bay County Extension: sends SMS broadcasts from `/partner` |
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

## SMS and USSD (Africa's Talking)

`SMS_ENV=simulate` (the default without keys) sends nothing: messages are
rendered in the farmer's language and stored with status `simulated`, so
Admin → Reach shows exactly what would have gone out. The USSD simulator on
the same page runs the real menu for any phone number.

To go live: create an Africa's Talking account, then set `AT_USERNAME`,
`AT_API_KEY`, `SMS_ENV=sandbox` (or `production` once you have credit and,
optionally, a sender ID in `AT_SENDER_ID`). Set `SMS_CALLBACK_SECRET` and
`USSD_SECRET` (`openssl rand -hex 24` each) and register these URLs on the AT
dashboard:

- SMS delivery reports: `<site>/api/sms/delivery/<SMS_CALLBACK_SECRET>`
- Incoming SMS (STOP/START): `<site>/api/sms/inbound/<SMS_CALLBACK_SECRET>`
- USSD service code callback: `<site>/api/ussd/<USSD_SECRET>`

Then put the leased USSD code in Admin → Reach → settings so SMS mention it.
The server sends queued SMS every 30 s; on hosts that pause idle servers,
call `/api/cron/sms` every minute or two with `Authorization: Bearer <CRON_SECRET>`.
The Africa's Talking API details (endpoints, status codes, callback fields)
were written from their documentation; check them against the dashboard
before going live.

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

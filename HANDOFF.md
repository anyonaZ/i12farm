# i12farm handoff

Last updated: 10 November 2026. Read this first when continuing in a new chat.

## 1. What i12farm is

A mobile-first web app (installable on Android from Chrome) that makes every
Kenyan farmer, however small, visible on a map, the way Airbnb did for small
guesthouses, and now lets buyers order and pay with M-Pesa (through Pesi Pay). Buyers find
produce, livestock, vets and training. Farmers get buyers and services.
Government and NGOs see county insights: prices, supply, demand. Every action is
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
| Languages | English and Kiswahili from day one (about 720 strings each; a native speaker should review) |
| Backend | Next.js server + PostgreSQL 15+ with PostGIS. No Supabase. RLS policies unchanged; `withUser()` sets the role per transaction |
| Sign-in | Phone or email + password (scrypt). Google optional. Email link for forgotten passwords; admins issue one-time links for farmers without email. **No SMS OTP** (costs money); farm ownership is proven with agent-issued claim codes |
| Sessions | Random token in an httpOnly cookie, SHA-256 in `auth.sessions`; 30 days idle, 180 days max; revoked rows are kept |
| Photos | Local disk (`/media`) or any S3-compatible bucket (Cloudflare R2). Shrunk to WebP on the phone first |
| Payments | **Pesi Pay by Switchlink** (decided 10 Nov 2026; replaces Daraja). Buyers approve an M-Pesa prompt sent through Pesi. Money is held until the buyer confirms receipt, then owed to the farmer. Pesi can also pay out (M-Pesa, bank, till, paybill) after a name check ("Hakikisha"); payouts and refunds go out **only in batches an admin approves** (decided 10 Nov 2026): prepare (names checked, money reserved) → review → approve and send → Pesi completes or fails each line. Paying by hand is still possible for money not in a batch. Not yet connected: no Switchlink account |
| Commission | 10% default in `platform_settings` (still an open business decision: deck says 10%, concept doc 5–10%). Each order keeps the rate it was placed with |
| Screens | Phone first (bottom tabs, one column). From 1024 px wide: top navigation bar, Explore as list beside map (hover a farm to light its pin, click a pin to find the farm), farm pages in two columns with a sticky order/contact panel, wider My Farm, Admin and lists. `src/lib/use-media.ts` holds the breakpoint |
| Location privacy | Exact point is private (`farm_locations`). Public pin is exact, snapped to ~1 km (default), or hidden |
| Order upkeep | Orders left "ready" complete automatically after 3 days (setting), unpaid orders cancel after 48 hours, silent M-Pesa prompts expire after 1 hour (a late success still counts). `run_maintenance()` runs nightly and from Admin → Settings |
| Bookings | Training and farm tours go through the same cart and M-Pesa flow, with a visit date (tomorrow to 4 months ahead) and morning/afternoon slot; the farm confirms by accepting |
| Featured listings | Farms pay by M-Pesa to appear first on the map and in search with a Featured badge. Plans are a setting: 7 days KES 200, 30 days KES 600 (**placeholder prices**). A second plan starts when the first ends |
| Payouts | Through Pesi in admin-approved batches (`/admin/payouts`). Each farm saves where its money goes (M-Pesa, bank, paybill, till) in My Farm, checked with Pesi. **Pesi's charges are carried by farmers** (decided 10 Nov 2026): collection charge from the farmer's share, payout charge from the payout; refund transfers carried by i12farm. Amounts in Admin → Settings, 0 until Switchlink's price list arrives. Fallback: payout CSV out, results CSV in, or record by hand |
| Dashboards | Built into Admin → Insights (no Metabase): KPIs, weekly paid value, view→contact→order funnel, pilot counties, top products, CSV exports |
| Seed farm | Homa Organica, Benedict Kotonya, Lang'ata (Nairobi): pigs and racing pigeons, `/f/homa-organica`. Phone, prices and stock are placeholders until Benedict confirms |

| No SMS, no USSD | **Decided 10 Nov 2026.** Removed with migration `20261110000100_no_sms.sql` (the Phase 3 migration stays as history). Farmers and vets learn of new orders and vet requests in the app (tab badges); partner SMS broadcasts are gone and the partner role now opens county insights |
| Vet requests | Anyone signed in asks for a vet (animal, problem, county, how soon); every published vet-service farm in that county sees it in the Vets tab; first to accept wins and both sides get each other's number. Vets don't see the farmer's number until they accept. Up to 3 open requests per person or phone; open requests expire after 48 h. Free for now |
| Maps | Google Maps (Maps JavaScript API, Advanced Markers, marker clustering) when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set; MapLibre + OpenFreeMap otherwise, and automatically if Google fails (bad key, billing off, not loaded in 8 s); Leaflet for phones without WebGL. Decided 10 Nov 2026 |
| Insight privacy | Partners and the public see aggregates only. Groups smaller than 3 (setting `insight_min_count`) are hidden or folded into "Other". Searches are logged without user id or IP (hashed device id), kept 180 days; the public "wanted" list shows everyday farm words only |
| Demo mode | `npm run dev` always simulates. A production build refuses simulated payments, open callbacks and "Simulate: pay" unless `DEMO_MODE=true` is set on purpose (a banner then says nothing is real). Without Pesi keys and without demo mode, checkout says payments are not switched on yet |
| Unanswered paid orders | The order waits on the farm's Orders badge; at 36 h it is declined and the buyer's refund is due (setting in Admin → Settings). The 6 h reminder SMS went with SMS |
| Notifications | Free web push instead of SMS (decided 10 Nov 2026). Opt-in per device, per-topic switches, text in the person's language. Needs VAPID keys |
| Safety | Report a farm; 3 different reporters hide an unverified farm until review (verified farms never auto-hidden); 3 new farms/day per account; 5 sign-ups/hour per network; honeypot field. All limits are settings |
| Account deletion | Name, phone, email, password, saved farms and Google link removed; farms only that person managed are hidden; orders, payments and ledger kept without the name (tax/payment records). Blocked while orders are open, money is owed to them, or they manage unclaimed farms |
| Privacy | Draft privacy notice and terms at `/privacy` and `/terms` (`src/content/legal.ts`), linked from sign-up. **Needs a Kenyan lawyer's review and a decision on ODPC registration** before launch. Set `NEXT_PUBLIC_CONTACT_EMAIL` |

Still open: commission rate, featured-listing prices, annual subscription, domain, whether to automate payouts with the B2C API, whether vet requests carry a fee, whether partners pay for county insights, the Google Maps billing account (and a budget alert).

## 4. Status

| Phase | State |
| --- | --- |
| 0 Foundations | Done |
| 1 Be seen | Done and now actually built and run: `npm run build` clean, flows walked in a phone-sized browser |
| 2 Trade | **Built.** Own accounts, claim codes, cart, orders, M-Pesa (simulate + Daraja, moved to Pesi on 10 Nov), ledger, reviews, messaging, admin (11 Oct). Bookings, featured listings, order upkeep, payout file, Insights dashboard, rate limits (18 Oct). Waiting on a real Pesi test (gate below) |
| 3 Reach | Built 23 Oct in simulate mode (SMS alerts, USSD menu, vet requests, partner broadcasts). **10 Nov: SMS, USSD and broadcasts removed by decision**; vet requests stay, in the app; Admin → Reach became Admin → Vet requests |
| 3.5 Hardening | **Done (4 Nov)** after the audit: demo mode locked in production builds, Next.js / Nodemailer / MapLibre upgraded (0 advisories), security headers, backup job skips without secrets, privacy notice + terms + download my data + delete my account, unanswered paid orders reminded then declined and refunded, edit farm and products after publishing, agent farm list with search, wizard drafts, tab badges, forgiving search, branded 404, clean farm links, link previews, sitemap |
| 4 Insight | **Built (10 Nov)**: public `/prices` (weekly county median per product, 12-week chart with range and table, change over 4 weeks, "buyers looked for and found little"), "County median" beside prices on farm pages, partner `/partner` county insights (farms by type, on sale and medians, orders and value, buyer contacts, vet requests by animal, most searched and not found; 30/90/365 days), anonymous search log. Google Maps integrated with the free map as fallback |

Pre-production design review and fixes (12 Nov 2026). Zacc asked for a full
critique, then for every finding fixed **except payments** (he is still
deciding how payments should work, so payment wording, the long payment
reference, the M-Pesa/Pesi naming, admin payout/refund buttons and the Money
tab layout were left as they are). Fixed:
- Explore on a computer: the category row can now be scrolled with the mouse
  wheel, ‹ › buttons and dragging (`src/components/ScrollRow.tsx`, also used
  for the admin tabs and the agent's farm filters). The farm count no longer
  jumps: the map frames all farms once on first load, and a framing asked for
  while the map is still loading is kept (MapLibre, Google and Leaflet).
- Confirmation before anything that can't be undone: buyer "I received it"
  (second tap, "Yes, I got it" / "Not yet"); admin giving the Admin role,
  suspending someone, verifying/unverifying a farm. After accepting, the
  farmer's "Decline" reads "Can't fulfil it" / "Cancel and refund".
- Checkout keeps delivery choice, note and visit date through sign-in
  (sessionStorage, this tab only; cleared once the order is placed).
- Form errors: our own message under the field, in English or Kiswahili,
  instead of the browser's English bubble (`src/components/FieldErrors.tsx`,
  works for every form; a field can set `data-error`). Sign-in heading,
  browser title and link follow the Create account tab (`?tab=up`).
- Every page title is translated (`titles` in messages, `src/lib/titles.ts`);
  order pages are titled "Order #ABC123".
- Tap targets 44 px+ (chips, period buttons, stock box, small links via the
  `.hit` class), no text under 12 px outside payout pages, grey pills darker
  (contrast), placeholders 4.5:1, skip-to-content link, named progress bar,
  keyboard-scrollable admin tables, reduced-motion respected.
- Market prices no longer overflows phones narrower than 405 px.
- Admin: unknown `?tab=` opens People; insight tiles wrap instead of cutting
  off; chart labels readable.
- Vets: a vet sees requests for them first (also in reading order); the
  county list puts counties that have vets first.
- Farm page: a farm with no phone gets "Message the farm" in the bottom bar.
- Orders show "Buyer ···003" when the buyer gave no name; demo seed marks
  demo conversations read (no more "115 unread").
- Theme-ready: logo, map pins, charts and farm covers now take their colours
  from the tokens in `globals.css` (plus `--color-danger`, `--color-muted`,
  `--color-map`, `--cover-*`); `<Icon>` carries `data-icon` so a new icon set
  is a one-file swap. Three looks were mocked on the real screens for Zacc to
  choose (A Savanna Gold + Phosphor, B Emerald Fresh + Hugeicons, C Red Soil +
  Tabler; all MIT); waiting on his choice.
Verified: 136 database checks, production build, all 196 page loads at 360 px
and 1366 px in both languages (no errors, no sideways scroll, one h1, no raw
keys), and browser walkthroughs of each fix.

Verified on 10 Nov 2026 (Phase 6 and charges): 136 database checks (17 new:
push subscriptions private and moved to whoever signed in last on a shared
phone, paid order → farm, answers → buyer, topics off send nothing, one waiting
message notification per conversation, sender queue shape, can't report own
farm, one report per person, 3 reporters hide an unverified farm but never a
verified one, reports admin-only, admin restore, 3 new farms/day, 5
sign-ups/hour/network, 6-hour nudge once; fee bands, collection charge fixed at
payment and taken at completion, payout charge on the line and its own ledger
memo, payout smaller than the charge refused). Push sending against a local
HTTPS stand-in: VAPID-signed, aes128gcm, payload decrypted to the Kiswahili
"Oda mpya #ABC123", a 410 device switched off. Browser: My Farm prompt,
Account notifications (in this sandbox the browser can't reach Google's push
service, so subscribing shows "Couldn't turn on notifications"), report a farm
→ Admin → Farms shows it with the note, Pesi charges saved from Settings.
NOT verified: a notification arriving on a real phone.

Verified on 10 Nov 2026 (payout batches): 119 database checks (batches
replace single payouts: only admins prepare, a draft reserves the money,
nothing counts as paid before approval, approval recorded and only once, batch
closes when every line is final, failed/removed/cancelled lines are due again,
batches admin-only). Browser, against the Pesi stand-in: agent saves an M-Pesa
and a bank payout account (an unregistered number is refused with Pesi's
reason), admin sees the balance and what is due, prepares a batch of two
payouts and a refund, approves ("Send KES 43,350 … cannot be undone"), the
page follows the callbacks to Done: one paid with its trace id, two failed
with Pesi's reason and due again. Same flow in simulate mode: all three paid
and in the ledger. Top bar fits at 1024, 1280 and 1440 px for an admin.

Verified on 10 Nov 2026 (Pesi): 117 database checks (9 new: payments default
to Pesi, bank list, payout accounts private and only set by farm managers with
history, only admins start payouts, in-flight money reserved, unique
references, ledger written once and only on COMPLETED, failed payouts free the
money, farms see their payouts). Against the local Pesi stand-in: encrypted
sign-in, STK push, PROCESSING/COMPLETED/FAILED callbacks, status confirmation,
a buyer pays and the order shows Paid; a cancelled prompt shows "didn't go
through" and can be sent again; Hakikisha refuses an unregistered number;
payout account saved with the checked name; payout sent, a second payout of the
same money refused, callback recorded it in the ledger; balance read.
NOT verified: anything against Pesi itself.

Verified on 10 Nov 2026: 108 database checks (the Phase 3 SMS/USSD checks retired; 10 new for Phase 4: weekly
median from price history with drafts excluded and earlier weeks using earlier
prices, benchmarks, search log hashing, county from map position, 60-an-hour
limit, half-typed words dropped, phone numbers and single-device terms hidden,
public list limited to farm words, partner-only insight with trade hidden
below 3 orders, 180-day pruning; and "no SMS or USSD left in the database"),
typecheck, production build with and without a Maps key (security headers
allow Google only with a key), browser walkthrough of `/prices` (desktop chart
hover, county filter, phone width without sideways scroll), farm page median,
partner dashboard for all counties and Kisumu at 30/90 days, a search from
Explore landing in the log with its county, and Google Maps: real Google
can't be reached from the build sandbox, so (a) with a key set and Google
blocked, Explore fell back to MapLibre, and (b) with a stand-in of the Google
API, pins, clustering and search-fit ran through the Google code path. **Not
verified: real Google Maps with a real key.**

Verified on 4 Nov 2026: 110 database checks (8 new: unanswered paid orders,
search, account deletion, badges, farm links), `npm audit` clean, production
build, the audit sweep again (23 pages × 6 roles × phone/desktop × English and
Kiswahili: no layout, label or server issues left), all six scripted journeys
including a new one for Phase 3.5 (agent finds a farm in the list, adds,
pauses and removes products, edits details, pauses the farm; wizard draft
survives a reload; farmer sees an Orders badge; data download; account
deletion and the number refused at sign-in), and the map on MapLibre 6.
Audit report: https://claude.ai/artifact/RfzJPhxTdw5GMqmkC3BS4b

Verified on 23 Oct 2026: 102 database checks (18 new for Phase 3: order
SMS, USSD ownership and order rules, price/stock by USSD, private outbox, vet
request alert/accept/expiry on web and USSD, partner-only broadcasts, opt-out
skipping), production build, USSD menus by HTTP exactly as Africa's Talking
calls them, and a browser walkthrough: buyer requests a vet on a phone, agent
(Maseno Vet Point) accepts on desktop and sees the number, buyer sees the vet;
partner composes a Homa Bay broadcast, admin approves, the SMS loop "sends"
(simulated) and the partner sees delivery counts; USSD simulator. Not verified
here: real Africa's Talking calls (no internet access to it from the sandbox).

Verified on 18 Oct 2026: 84 database checks (security, trade, phase 2b),
production build, and a browser walkthrough of the new parts: book a farm
training with a visit date, pay (simulated), farm accepts and marks ready,
buyer confirms; agent buys a 30-day featured plan for Homa Organica, which then
leads Explore with a Featured badge; admin Insights, payout CSV download →
upload with receipts → recorded, settings, run upkeep, CSV exports. Last
week's walkthroughs were re-run and still pass.

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
2. Get Pesi development credentials from Switchlink (client id, secret, encryption key, account numbers) and test one payment and one payout on their SIT gateway (README → Payments). Send them the questions in section 10.
3. Create a Google Maps API key and Map ID (README → Maps), set a budget alert, rebuild, and check Explore, the pin wizard and a farm page map on a real phone.
4. Have a lawyer review `/privacy` and `/terms` and confirm whether i12farm must register with the ODPC.
5. Confirm Homa Organica's real phone, prices and stock with Benedict; update in My Farm (or have Benedict claim the farm himself with a claim code).
6. Pick hosting (section 9) and deploy the pilot.

## 6. Repository map

```
prototype/index.html               clickable demo (canvas map, sample data, localStorage)
src/app/page.tsx                   Explore → components/explore/ExploreClient.tsx
src/app/f/[slug]/page.tsx          farm page: cart steppers, reviews, Message, contact bar
src/app/checkout/                  cart re-pricing, pickup/delivery, M-Pesa number
src/app/orders/                    order list, order page (payment panel, farm/buyer actions, review)
src/app/inbox/                     conversations, thread (polling), /inbox/order/<number>
src/app/my-farm/                   dashboard, PinWizard, FarmTools (claim code, photos, stock),
                                   feature/[farmId] (buy a featured plan)
src/app/account/                   profile, sign-in details, password, devices, claim a farm
src/app/admin/                     insights, people, farms to verify, money (payouts, refunds, CSV),
                                   vets (recent vet requests, request expiry setting),
                                   settings (commission, upkeep days, featured plans), export/[kind]
src/app/my-farm/[farmId]/          one farm's tools (agents open it from the searchable list); edit/ = edit farm details and pin
src/app/privacy, terms/            privacy notice and terms (text in src/content/legal.ts)
src/app/account/export/            Download my data (JSON)
src/app/api/me/counts/             tab-bar badge numbers
src/app/f/[slug]/preview/          link preview picture for farms without photos
src/app/sitemap.ts, robots.ts      search engines
src/lib/demo.ts                    demo mode rules (simulate only in dev or with DEMO_MODE=true)
scripts/copy-map-worker.mjs        copies MapLibre's worker to public/ before dev and build
src/app/vets/                      request a vet, my requests, vet inbox (accept / done), vets list
src/app/partner/                   county insights for partners and admins (Phase 4)
src/app/prices/                    public market prices: county medians, chart, "wanted" words
src/app/sign-in, auth/*            sign-in/up forms, Google start/callback, one-time link, sign-out
src/app/api/                       farms (map box), farms/search, contact, events, farms/[id]/photos,
                                   orders/[number] (status poll), conversations/[id]/messages,
                                   pesi/callback/[secret], promotions/[id], cron/maintenance
                                   (farms/search also logs the search for demand signals)
src/app/media/[...path]            serves locally stored photos
src/domains/                       farms, reference, identity, orders (+payments.ts), messaging,
                                   promotions, admin (+insights.ts), vets, insights (prices, demand, county)
src/components/map/                FarmMap (picks Google / MapLibre / Leaflet), GoogleMap, RasterMap
src/components/insight/            PriceChart (hover + table), Sparkline
src/lib/push.ts                    web push sender (outbox → text in the person's language → devices)
src/components/notify/PushToggle   notifications switch (Account) and prompts (My Farm, Vets)
src/components/farm/ReportFarm     "Report this farm"; admin side in src/app/admin/ReportedFarms.tsx
src/lib/rate-limit.ts              in-memory limits on events, contact taps, messages, uploads
src/lib/db.ts                      Postgres pool, withUser() (RLS context), dbMessage()
src/lib/auth/                      password (scrypt), session, viewer, accounts, google
src/lib/pesi.ts                    Pesi Pay client: encrypted sign-in, STK push, status, Hakikisha, disbursements, callbacks, simulate
src/domains/admin/disbursements.ts payouts and refunds through Pesi in approved batches (payout accounts, prepare, approve, send, confirm)
src/app/admin/payouts/             batch list, prepare a batch, batch page (review, approve, follow)
src/app/my-farm/[farmId]/payouts/  where the farm's money goes, payout history
scripts/pesi-mock.mjs              local stand-in for the Pesi gateway (npm run pesi:mock)
scripts/pesi-register-callback.mjs one-time callback registration with Pesi (once per account!)
src/lib/media.ts, media-url.ts     photo storage drivers (local / S3), public URLs
src/lib/cart.ts                    one-farm cart in localStorage
messages/en.json, sw.json          all UI text (keys must match in both)
db/migrations/                     schema source of truth (platform → foundation → … → trade)
db/seed.sql, seed_demo.sql         dev accounts + 8 test farms; 28 demo farms incl. Homa Organica
db/tests/                          security_test.sql, trade_test.sql, phase2b_test.sql, vets_test.sql, hardening_test.sql, insight_test.sql, pesi_test.sql, safety_test.sql (+ PostGIS stand-in)
scripts/db.mjs                     migrate / status / seed / reset
scripts/test-db.sh                 fresh database, all migrations, seed, all test files
.github/workflows/                 ci.yml (build + DB tests), backup.yml (rollup + order upkeep + encrypted dump)
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
- `apply_order_status()` is the single place an order moves and its money follows; users reach it through `set_order_status()`, the system through `run_maintenance()`.
- Money out through Pesi only in batches: `admin_create_payout_batch()` reserves the amounts (no double payouts, also blocks paying the same money by hand), `admin_approve_payout_batch()` records the approver and releases the lines to be sent, `admin_remove_batch_line()` / `admin_cancel_payout_batch()` work only before approval; `record_disbursement_result()` (server-only, idempotent) writes `payout_sent`/`refund_sent` only on COMPLETED. `farm_payout_accounts` is private to the farm's managers and admins; every change goes to `farm_payout_account_history`.
- Featured status is public only as a yes/no (`farm_featured()`); promotion rows and their payments are private to the farm's managers and admins.
- Admin actions are SECURITY DEFINER functions that check the admin role and write the audit log.
- Vet requests move only through `create_service_request` / `take_service_request` / `close_service_request`; `service_request_history` is append-only.
- `search_log` has no policies: nothing reads it except `search_demand`, `unmet_demand` and `county_insight`, which only return groups of 3+ devices. `log_search()` hashes the device id and never stores a user id or IP.
- Insight functions (`price_index`, `price_benchmarks`, `unmet_demand` public; `county_insight` partner/admin) are read-only aggregates.
- A deleted account keeps its row (status `deleted`, no identifiers) so orders and the ledger stay consistent; `delete_my_account()` is the only way in.
- `search_aliases` maps everyday words (milk, mayai, nguruwe…) to farm types; add rows freely.
- Counties, sub-counties and wards use official codes.

## 8. Known gaps

- Payouts are semi-manual (bulk payment file in, results file out). B2C API automation needs Safaricom go-live and an initiator certificate.
- Google Maps untested against real Google (blocked in the build sandbox); the fallback is tested.
- Prices are asking prices from listings, not prices paid; pilot counties have few farms per product, so medians move with one farm. Units differ by product (litre, tray of 30, 90 kg bag); medians are per product and unit.
- Searches are logged from Explore only, after the 400 ms typing pause; half-typed words are filtered in SQL. Searches without a county filter take the county nearest the map centre (within 80 km).
- Vet requests: no in-app chat with the vet, no fee, no rating of vets yet; matching is by county only.
- Chat is polling, not push (fine for the pilot; cheap on any host).
- Rate limits on events, contact taps, messages and uploads are in memory per server process: solid on one VM, partial on serverless hosts.
- Farms with no phone at all (no public, WhatsApp or owner sign-in phone) can't be paid from the payout file until one is added.
- After a migration, restart the app server: Postgres refuses cached query plans whose columns changed ("cached plan must not change result type").
- The privacy notice and terms are drafts (see Decisions).
- Payment-related findings from the 12 Nov design review are open on purpose until the payment approach is settled: completed-order text still says the farmer "is being paid" (payouts are batched), the payment reference shows in full, M-Pesa/Pesi naming is mixed, admin Record payout/refund have no confirmation, the admin Money → Pesi card is cramped on phones.
- Bookings have no farm calendar: the farm accepts or declines the date the buyer picked.
- A Kiswahili native speaker should review all text.
- Map tiles are not cached offline; pages and photos are.
- Map fallbacks (18 Oct): browsers without WebGL get Leaflet with OpenStreetMap image tiles (fine for a minority; OSM's tile policy forbids heavy use, so switch provider if that path grows). If the vector style can't be downloaded, pins draw on a plain background with a Retry notice.
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

## 10. Next phase (roadmap, agreed order to be confirmed with Zacc)

**Gates (need you, not code):** Switchlink onboarding (development credentials,
then production); a Google Maps key with billing and a budget alert; a
lawyer's review of `/privacy` and `/terms`; hosting (section 9) and a domain.
The Pesi callback can be registered only once per account, so register it on
the final domain.

| Step | What | Needs |
| --- | --- | --- |
| 5a Pesi groundwork | **Done 10 Nov**: client, collections moved from Daraja, callback, payout/refund engine, payout accounts, bank list, stand-in, tests | — |
| 5b Payouts in the app | **Done 10 Nov**: My Farm → "Where we send your money" (name checked with Pesi) and payout history; `/admin/payouts`: Pesi balance, everything due, prepare batch, review names, take lines out, cancel, approve and send, live status, "Check with Pesi"; manual and CSV kept as fallback. Still to do: statement reconciliation against Pesi's transaction history | Who carries Pesi's fees (open) |
| 5c Pesi go-live | Test on Pesi SIT with real credentials, replace the guessed response shapes with real samples, register the callback, then production | Switchlink answers (below) |
| 6 Keep people informed | **Done 10 Nov**: web push (new paid order, farm's answers, messages, vet requests and acceptance, payout sent, 6-hour nudge), Account → Notifications with topics, prompts on My Farm and Vets; report a farm + auto-hide + Admin → Farms review; new-farm and sign-up limits; honeypot. Also: Pesi charges carried by farmers (settings, order page, batch page) | VAPID keys (free) |
| 7 Ads | Sponsored farm cards, top search spot, vet spotlight, Prices-page banner; self-serve from My Farm, paid through Pesi, admin review, "Sponsored" label, view/tap/call stats | Ad prices per placement per county |
| 8 Library | Farming books: book pages, free preview, buy through Pesi, in-app PDF reader (PDF.js), private files with per-buyer watermark, offline reading, author payouts through Pesi | Who sells (i12farm only or approved authors), commission, tax advice on e-book sales |
| Later | Partner CSV exports and a monthly county price summary; booking calendar; vet ratings and fees; photos in messages | — |

**Ways to earn without squeezing farmers and vets (proposed 10 Nov, not decided)**
The rule of thumb: keep basic use free for farmers and vets, keep the
commission modest, and charge the sides that have more money (buyers,
institutions, companies) or that choose to pay for extra.
1. Commission (built, 10%): make it tiered and capped, e.g. lower for small farms or orders, a cap per order so a KES 85,000 heifer doesn't pay KES 8,500, a little higher for agro-dealers selling inputs.
2. A small buyer service fee per order (like Airbnb's guest fee), so farmers keep more.
3. Featured listings (built) and ads (step 7): paid only by those who choose.
4. Optional Pro plan for farms, vets and agro-dealers: lower commission, more photos/video, farm analytics, priority support.
5. Institutional insight subscriptions: county governments, NGOs, input companies, processors, banks and insurers pay for county dashboards, CSV exports and a price index feed (aggregates only).
6. Business buyer accounts: hotels, schools, supermarkets, processors: standing orders, invoices, monthly fee.
7. Partner referral fees: insurers, input-credit lenders, seed/feed companies pay for farmers who sign up through i12farm (only with the farmer's consent).
8. Delivery: a margin on deliveries arranged with partner riders.
9. Library (step 8): commission on book sales; paid courses with experts.
10. Sponsored content: an input company sponsors the weekly price summary or a training video (clearly labelled).

**Questions for Switchlink before going live**
1. The response body of `initiateStkPush`, `FetchIPNStatus` and `Disburse/Single` (the document shows none).
2. Does the collection callback include the amount, the payer's phone and the M-Pesa receipt? It currently shows only Partner_transaction_id, Status_code, Status_description, Trace_Id and Transaction_status.
3. Are callbacks signed, or can you give the IP addresses they come from? We also confirm each one with FetchIPNStatus.
4. All status codes (we know 200 processing, AC100 completed, AC300 failed), and the code for "customer cancelled the prompt" and "prompt timed out".
5. Callback registration is once per account: do collections and disbursements share one URL? Can SIT and production have different URLs?
6. Limits on `partnerReference` / `partnerTransactionId` (length, characters). We send 28 characters like `I12P` + 24 hex.
7. B2B payouts: is the paybill/till number `receiverBank` (as in the example) or `receiverBankCode` (as in the bulk example)? Bulk paybill and till both point at `BulkDisburse/Bank`: is that right?
8. Fees for collections and for each payout type, and how settlement to our bank works.
9. Token lifetime and whether a refresh token will be used.
10. Which `clientAccountReference` to use for collections, and which `sourceAccount` (MCA…) for payouts.

# Domains

Code is grouped by business domain, not by technical layer. Each folder owns
its tables and exposes plain functions; one domain never queries another
domain's tables directly, it calls that domain's functions. This keeps the
monolith splittable later without a rewrite.

| Folder      | Owns tables                                              | Ships in |
| ----------- | -------------------------------------------------------- | -------- |
| `reference` | counties, sub_counties, wards, farm_categories, products | Phase 0  |
| `identity`  | profiles                                                 | Phase 0  |
| `farms`     | farms, farm_locations, farm_media                        | Phase 1  |
| `listings`  | listings, price_history, contact_events                  | Phase 1  |
| `orders`    | orders, order_items, order_status_history                | Phase 2  |
| `bookings`  | bookings                                                 | Phase 2  |
| `reviews`   | reviews                                                  | Phase 2  |
| `messaging` | conversations, messages                                  | Phase 2  |
| `services`  | service_requests                                         | Phase 3  |
| `insights`  | price index, county insight, demand (read-only)          | Phase 4  |
| `analytics` | events, events_daily (see `src/lib/analytics`)           | Phase 0  |

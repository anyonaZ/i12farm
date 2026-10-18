// The full list of event names. Adding a name here is how a new event is
// "registered"; anything else is rejected by /api/events. Keep names stable:
// renaming breaks year-on-year analysis.
export const EVENT_NAMES = [
  'page.view',
  'app.install_prompted',
  'app.installed',
  'app.offline',
  'auth.sign_in_started',
  'auth.signed_in',
  'auth.signed_out',
  'locale.changed',
  'explore.category_tapped',
  // Phase 1 (reserved now so dashboards can be built against them)
  'farm.pin_started',
  'farm.pin_step_completed',
  'farm.published',
  'farm.viewed',
  'listing.created',
  'listing.viewed',
  'contact.tapped',
  'search.performed',
  'map.moved',
  'map.pin_tapped',
  'explore.county_selected',
  'farm.saved',
  'listing.price_changed',
  // Phase 2 · Trade (own accounts, orders, M-Pesa, reviews, messaging)
  'auth.signed_up',
  'farm.claim_code_issued',
  'farm.claimed',
  'farm.photo_added',
  'listing.quantity_changed',
  'cart.item_added',
  'cart.item_removed',
  'checkout.started',
  'order.placed',
  'order.status_changed',
  'payment.requested',
  'payment.succeeded',
  'payment.failed',
  'review.left',
  'conversation.opened',
  'message.sent',
  // Phase 2b
  'promotion.started',
  'booking.date_chosen',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export type EventProperties = Record<string, string | number | boolean | null>;

export interface ClientEvent {
  name: EventName;
  occurred_at: string; // ISO time on the phone; the server clamps it
  path?: string;
  properties?: EventProperties;
}

export interface EventBatch {
  anonymous_id: string;
  session_id: string;
  locale?: 'en' | 'sw';
  app_version?: string;
  events: ClientEvent[];
}

export const MAX_BATCH = 25;

export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && (EVENT_NAMES as readonly string[]).includes(value);
}

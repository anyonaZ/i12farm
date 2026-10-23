import 'server-only';
import { createTranslator } from 'next-intl';
import { getSql } from '@/lib/db';
import { dbMessage } from '@/lib/db';
import en from '../../../messages/en.json';
import sw from '../../../messages/sw.json';

// USSD menu for feature phones (*384*12# or whatever code is leased).
//
// The network sends every keypress so far as one string joined by "*"
// ("1*2*450"), so the handler is stateless: it replays the path from the top
// each time. "0" goes back and "00" goes home on menu screens; on number
// screens 0 is an ordinary value (e.g. stock 0 = sold out).
//
// Callers are known by the phone number the network gives us. Farm actions
// only touch farms with that number (see ussd_* functions in SQL).

const MAX = 182; // characters a USSD screen can show on most handsets

type Locale = 'en' | 'sw';
type T = ReturnType<typeof makeT>;
const makeT = (locale: Locale) => createTranslator({ locale, messages: locale === 'en' ? en : sw, namespace: 'ussd' });

interface Ctx {
  phone: string;
  user_id: string | null;
  locale: Locale;
  opted_out: boolean;
  farms: { id: string; name: string; county: number; vet: boolean }[];
  county: number | null;
}

type Screen = { type: 'menu'; text: string; options: number } | { type: 'input'; text: string } | { type: 'end'; text: string };

const ANIMALS = ['dairy', 'beef', 'poultry', 'goats', 'sheep', 'pigs', 'rabbits', 'fish', 'bees'] as const;

export interface UssdRequest {
  phone: string;
  text: string;
  sessionId?: string;
}

export async function handleUssd(req: UssdRequest): Promise<string> {
  const sql = getSql();
  const digits = req.phone.replace(/\D/g, '');
  const [{ ctx }] = await sql<{ ctx: Ctx | null }[]>`
    select case when public.normalise_ke_phone(${digits}) is not null then public.ussd_context(${digits}) end as ctx`;
  if (!ctx) return 'END i12farm works with Kenyan mobile numbers only.';

  const tokens = req.text ? req.text.split('*').map((s) => s.trim()) : [];
  if (tokens.length === 0) {
    await sql`insert into public.events (name, anonymous_id, properties, path)
              values ('ussd.session', 'server', ${sql.json({ registered: ctx.farms.length > 0, vet: ctx.farms.some((f) => f.vet) })}, '/ussd')`;
  }

  // Replay the path; menu screens understand 0 (back) and 00 (home).
  const app = new Menu(ctx);
  let state: string[] = [];
  let invalid = false;
  for (const tok of tokens) {
    const screen = await app.screen(state, false);
    if (screen.type === 'end') break;
    invalid = false;
    if (screen.type === 'menu') {
      if (tok === '00') {
        state = [];
        continue;
      }
      if (tok === '0' && state.length) {
        state.pop();
        continue;
      }
      const n = Number(tok);
      if (!Number.isInteger(n) || n < 1 || n > screen.options) {
        invalid = true;
        continue;
      }
    }
    state.push(tok);
  }
  const screen = await app.screen(state, true);
  const prefix = invalid ? `${app.t('invalid')}\n` : '';
  if (screen.type === 'end') return `END ${fit(screen.text)}`;
  const back = state.length && screen.type === 'menu' ? `\n0. ${app.t('back')}` : '';
  return `CON ${fit(prefix + screen.text + back)}`;
}

function fit(text: string): string {
  return text.length <= MAX ? text : text.slice(0, MAX - 1) + '…';
}

function short(s: string, n = 16): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '.';
}

function menu(title: string, items: string[]): Screen {
  return { type: 'menu', text: [title, ...items.map((item, i) => `${i + 1}. ${item}`)].join('\n'), options: items.length };
}

function kes(n: number | null): string {
  return n === null ? '-' : Math.round(n).toLocaleString('en-KE');
}

class Menu {
  t: T;
  private sql = getSql();
  private cache = new Map<string, unknown>();

  constructor(private ctx: Ctx) {
    this.t = makeT(ctx.locale === 'en' ? 'en' : 'sw');
  }

  private async once<V>(key: string, load: () => Promise<V>): Promise<V> {
    if (!this.cache.has(key)) this.cache.set(key, await load());
    return this.cache.get(key) as V;
  }

  private get registered() {
    return this.ctx.farms.length > 0;
  }

  private rootItems(): string[] {
    const vet = this.ctx.farms.some((f) => f.vet);
    return this.registered
      ? ['orders', 'price', 'stock', 'requestVet', ...(vet ? ['vetInbox'] : []), 'sms', 'language']
      : ['requestVet', 'sms', 'language', 'about'];
  }

  private orders() {
    return this.once(
      'orders',
      () =>
        this.sql<{ number: string; status: string; total: number; summary: string | null; visit_date: string | null }[]>`
        select number, status::text, total, summary, visit_date::text from public.ussd_open_orders(${this.ctx.phone})`,
    );
  }

  private listings() {
    return this.once(
      'listings',
      () =>
        this.sql<{ id: string; title: string; unit: string; price_kes: number | null; quantity: number | null }[]>`
        select id, title, unit, price_kes, quantity from public.ussd_listings(${this.ctx.phone}) limit 6`,
    );
  }

  private vetRequests() {
    return this.once(
      'vetRequests',
      () =>
        this.sql<{ number: string; animal: string; place: string | null; urgency: string; name_en: string; name_sw: string }[]>`
        select r.number, r.animal, r.place, r.urgency, c.name_en, c.name_sw
        from public.ussd_vet_requests(${this.ctx.phone}) r join public.farm_categories c on c.slug = r.animal`,
    );
  }

  private counties() {
    return this.once(
      'counties',
      () =>
        this.sql<{ code: number; name: string }[]>`
        select code, name from public.counties
        where is_pilot or code = ${this.ctx.county ?? 0}
        order by code = ${this.ctx.county ?? 0} desc, name limit 8`,
    );
  }

  private animalNames() {
    return this.once(
      'animals',
      () =>
        this.sql<{ slug: string; name_en: string; name_sw: string }[]>`
        select slug, name_en, name_sw from public.farm_categories where slug = any(${ANIMALS as unknown as string[]})`,
    );
  }

  private animalName(slug: string, names: { slug: string; name_en: string; name_sw: string }[]) {
    const row = names.find((n) => n.slug === slug);
    return row ? (this.ctx.locale === 'en' ? row.name_en : row.name_sw) : slug;
  }

  async screen(state: string[], commit: boolean): Promise<Screen> {
    const t = this.t;
    const items = this.rootItems();
    if (state.length === 0) {
      const counts: Record<string, string> = {};
      if (this.registered) counts.orders = String((await this.orders()).length);
      if (items.includes('vetInbox')) counts.vetInbox = String((await this.vetRequests()).length);
      const title = this.registered ? t('hello', { farm: short(this.ctx.farms[0].name, 24) }) : t('welcome');
      return menu(
        title,
        items.map((k) => t(`items.${k}` as never, { count: counts[k] ?? '0' } as never)),
      );
    }
    const [first, ...rest] = state;
    const key = items[Number(first) - 1];
    switch (key) {
      case 'orders':
        return this.ordersScreen(rest, commit);
      case 'price':
      case 'stock':
        return this.listingScreen(key, rest, commit);
      case 'requestVet':
        return this.vetRequestScreen(rest, commit);
      case 'vetInbox':
        return this.vetInboxScreen(rest, commit);
      case 'sms':
        return this.smsScreen(rest, commit);
      case 'language':
        return this.languageScreen(rest, commit);
      case 'about':
        return { type: 'end', text: t('aboutText') };
      default:
        return { type: 'end', text: t('invalid') };
    }
  }

  private async ordersScreen(rest: string[], commit: boolean): Promise<Screen> {
    const t = this.t;
    const orders = await this.orders();
    if (!orders.length) return { type: 'end', text: t('noOrders') };
    if (rest.length === 0)
      return menu(
        t('items.orders', { count: orders.length }),
        orders.map((o) => t('orderLine', { number: o.number, total: kes(o.total) })),
      );
    const o = orders[Number(rest[0]) - 1];
    const paid = o.status === 'paid';
    if (rest.length === 1) {
      const head =
        t('orderDetail', { number: o.number, summary: short(o.summary ?? '', 60), total: kes(o.total) }) +
        (o.visit_date ? ` ${t('visit', { date: o.visit_date })}` : '');
      return menu(head, paid ? [t('accept'), t('decline')] : [t('ready'), t('decline')]);
    }
    if (rest[1] === '2' && rest.length === 2) return menu(t('confirmDecline', { number: o.number }), [t('yesDecline')]);
    const action = rest[1] === '1' ? (paid ? 'accept' : 'ready') : 'decline';
    if (!commit) return { type: 'end', text: '' };
    try {
      await this.sql`select public.ussd_order_action(${this.ctx.phone}, ${o.number}, ${action})`;
    } catch (error) {
      return { type: 'end', text: t('failed', { reason: dbMessage(error) }) };
    }
    return { type: 'end', text: t(action === 'accept' ? 'accepted' : action === 'ready' ? 'readyDone' : 'declined', { number: o.number }) };
  }

  private async listingScreen(kind: 'price' | 'stock', rest: string[], commit: boolean): Promise<Screen> {
    const t = this.t;
    const listings = await this.listings();
    if (!listings.length) return { type: 'end', text: t('noListings') };
    if (rest.length === 0) {
      return menu(
        t(`items.${kind}`),
        listings.map((l) =>
          kind === 'price'
            ? t('listingLine', {
                title: short(l.title),
                price: l.price_kes === null ? t('noPrice') : kes(l.price_kes),
                unit: short(l.unit, 8),
              })
            : t('stockLine', { title: short(l.title), quantity: l.quantity === null ? '-' : String(l.quantity), unit: short(l.unit, 8) }),
        ),
      );
    }
    const l = listings[Number(rest[0]) - 1];
    if (rest.length === 1) {
      return kind === 'price'
        ? {
            type: 'input',
            text: t('enterPrice', { title: short(l.title, 30), price: l.price_kes === null ? t('noPrice') : kes(l.price_kes) }),
          }
        : {
            type: 'input',
            text: t('enterStock', { title: short(l.title, 30), unit: l.unit, quantity: l.quantity === null ? '-' : String(l.quantity) }),
          };
    }
    const value = Number(rest[1].replace(/[,\s]/g, ''));
    if (!Number.isFinite(value) || value < 0 || !/^[0-9][0-9,.\s]*$/.test(rest[1])) return { type: 'end', text: t('badNumber') };
    if (!commit) return { type: 'end', text: '' };
    try {
      await this.sql`select public.ussd_update_listing(${this.ctx.phone}, ${l.id},
                       ${kind === 'price' ? Math.round(value) : null}, ${kind === 'stock' ? Math.round(value) : null})`;
      await this.sql`insert into public.events (name, user_id, anonymous_id, properties, path)
                     values (${kind === 'price' ? 'listing.price_changed' : 'listing.quantity_changed'}, ${this.ctx.user_id},
                             ${this.ctx.user_id ? null : 'server'}, ${this.sql.json({ listing: l.id, via: 'ussd' })}, '/ussd')`;
    } catch (error) {
      return { type: 'end', text: t('failed', { reason: dbMessage(error) }) };
    }
    if (kind === 'price') return { type: 'end', text: t('priceDone', { title: l.title, price: kes(value), unit: l.unit }) };
    return {
      type: 'end',
      text:
        value === 0
          ? t('stockSoldOut', { title: l.title })
          : t('stockDone', { title: l.title, quantity: String(Math.round(value)), unit: l.unit }),
    };
  }

  private async vetRequestScreen(rest: string[], commit: boolean): Promise<Screen> {
    const t = this.t;
    const counties = await this.counties();
    if (rest.length === 0)
      return menu(
        t('chooseCounty'),
        counties.map((c) => c.name),
      );
    const names = await this.animalNames();
    if (rest.length === 1)
      return menu(
        t('chooseAnimal'),
        ANIMALS.map((a) => this.animalName(a, names)),
      );
    if (rest.length === 2) return menu(t('urgency'), [t('today'), t('thisWeek')]);
    if (!commit) return { type: 'end', text: '' };
    const county = counties[Number(rest[0]) - 1];
    const animal = ANIMALS[Number(rest[1]) - 1];
    try {
      const [{ r }] = await this.sql<{ r: { number: string; vets: number } }[]>`
        select public.ussd_request_vet(${this.ctx.phone}, ${county.code}::smallint, ${animal}, ${rest[2] === '2' ? 'this_week' : 'today'}) as r`;
      await this.sql`insert into public.events (name, user_id, anonymous_id, properties, county_code, path)
                     values ('vet.requested', ${this.ctx.user_id}, ${this.ctx.user_id ? null : 'server'},
                             ${this.sql.json({ via: 'ussd', animal, vets: r.vets })}, ${county.code}, '/ussd')`;
      return { type: 'end', text: t('vetSent', { number: r.number, vets: r.vets }) };
    } catch (error) {
      return { type: 'end', text: t('failed', { reason: dbMessage(error) }) };
    }
  }

  private async vetInboxScreen(rest: string[], commit: boolean): Promise<Screen> {
    const t = this.t;
    const list = await this.vetRequests();
    if (!list.length) return { type: 'end', text: t('noVetRequests') };
    const animal = (r: (typeof list)[number]) => (this.ctx.locale === 'en' ? r.name_en : r.name_sw);
    if (rest.length === 0) {
      return menu(
        t('items.vetInbox', { count: list.length }),
        list.map((r) => t('vetLine', { number: r.number, animal: animal(r), place: short(r.place ?? '-', 14) })),
      );
    }
    const r = list[Number(rest[0]) - 1];
    if (rest.length === 1) {
      return menu(
        t('vetDetail', {
          number: r.number,
          animal: animal(r),
          place: r.place ?? '-',
          urgency: t(r.urgency === 'this_week' ? 'thisWeek' : 'today'),
        }),
        [t('takeIt')],
      );
    }
    if (!commit) return { type: 'end', text: '' };
    try {
      const [{ x }] = await this.sql<
        { x: { number: string; phone: string } }[]
      >`select public.ussd_take_request(${this.ctx.phone}, ${r.number}) as x`;
      return { type: 'end', text: t('taken', { number: x.number, phone: `0${x.phone.slice(3)}` }) };
    } catch (error) {
      const e = error as { code?: string };
      return { type: 'end', text: e.code === '55000' ? t('takenAlready') : t('failed', { reason: dbMessage(error) }) };
    }
  }

  private async smsScreen(rest: string[], commit: boolean): Promise<Screen> {
    const t = this.t;
    if (rest.length === 0) return menu(this.ctx.opted_out ? t('smsOff') : t('smsOn'), [this.ctx.opted_out ? t('turnOn') : t('turnOff')]);
    if (!commit) return { type: 'end', text: '' };
    const action = this.ctx.opted_out ? 'opt_in' : 'opt_out';
    await this.sql`select public.set_phone_pref(${this.ctx.phone}, ${action}, 'ussd')`;
    return { type: 'end', text: action === 'opt_out' ? t('smsNowOff') : t('smsNowOn') };
  }

  private async languageScreen(rest: string[], commit: boolean): Promise<Screen> {
    if (rest.length === 0) return menu(this.t('items.language'), ['English', 'Kiswahili']);
    if (!commit) return { type: 'end', text: '' };
    const locale: Locale = rest[0] === '1' ? 'en' : 'sw';
    await this.sql`select public.set_phone_pref(${this.ctx.phone}, ${locale === 'en' ? 'locale_en' : 'locale_sw'}, 'ussd')`;
    if (this.ctx.user_id) await this.sql`update public.profiles set preferred_language = ${locale} where id = ${this.ctx.user_id}`;
    return { type: 'end', text: makeT(locale)('langDone') };
  }
}

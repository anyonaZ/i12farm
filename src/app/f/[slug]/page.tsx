import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Icon, CATEGORY_ICON } from '@/components/Icon';
import { FarmCover } from '@/components/farm/FarmCover';
import { FeaturedBadge, VerifiedBadge } from '@/components/farm/FarmCard';
import { ContactBar } from '@/components/farm/ContactBar';
import { SaveButton } from '@/components/farm/SaveButton';
import { FarmMiniMap } from '@/components/farm/FarmMiniMap';
import { FarmViewTracker } from '@/components/farm/FarmViewTracker';
import { CartBar } from '@/components/cart/CartBar';
import { CartStepper } from '@/components/cart/CartStepper';
import { getFarmBySlug, isFarmSaved, listFarmReviews } from '@/domains/farms/queries';
import { openConversation } from '@/domains/messaging/actions';
import { listFarmCategories } from '@/domains/reference/queries';
import { getViewer } from '@/lib/auth/viewer';
import { formatQty, kes } from '@/lib/format';
import { publicMediaUrl } from '@/lib/media-url';
import type { Locale } from '@/i18n/config';

type Params = { params: Promise<{ slug: string }> };

// Farm links get shared on WhatsApp, so the preview (title, text, photo)
// comes from the farm itself.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const farm = await getFarmBySlug((await params).slug);
  if (!farm) return { title: 'Farm not found' };
  const place = [farm.place_name, farm.county?.name].filter(Boolean).join(', ');
  const image = publicMediaUrl(farm.media[0]?.storage_path);
  return {
    title: farm.name,
    description: `${place}. ${farm.description ?? ''}`.trim(),
    openGraph: { title: `${farm.name} · i12farm`, description: place, images: image ? [image] : undefined },
  };
}

export default async function FarmPage({ params }: Params) {
  const { slug } = await params;
  const farm = await getFarmBySlug(slug);
  if (!farm) notFound();

  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const [categories, saved, viewer, reviews] = await Promise.all([
    listFarmCategories(locale),
    isFarmSaved(farm.id),
    getViewer(),
    listFarmReviews(farm.id, 6),
  ]);
  const mine = Boolean(viewer && (farm.owner_id === viewer.id || farm.managed_by === viewer.id));
  const canOrder = !mine;
  const cartFarm = { id: farm.id, slug: farm.slug, name: farm.name };
  const message = openConversation.bind(null, farm.id, `/f/${farm.slug}`);
  const catName = (s: string) => categories?.find((c) => c.slug === s)?.name ?? s;
  const productName = (l: (typeof farm.listings)[number]) =>
    l.product ? (locale === 'sw' ? l.product.name_sw : l.product.name_en) : l.title;
  const place = [farm.place_name, farm.sub_county?.name, farm.county?.name]
    .filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i)
    .join(', ');
  const hasPin = farm.public_lng !== null && farm.public_lat !== null;

  return (
    <main className="pb-64">
      <FarmViewTracker farmId={farm.id} />
      <div className="relative aspect-[16/11] max-h-80 w-full overflow-hidden">
        {farm.media.length > 1 ? (
          <div className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]">
            {farm.media.map((m) => (
              <div key={m.id} className="h-full w-full shrink-0 snap-start">
                <FarmCover id={farm.id} name={farm.name} category={farm.categories[0]} coverPath={m.storage_path} />
              </div>
            ))}
          </div>
        ) : (
          <FarmCover id={farm.id} name={farm.name} category={farm.categories[0]} coverPath={farm.media[0]?.storage_path} />
        )}
        <Link
          href="/"
          aria-label={t('farm.back')}
          className="absolute left-4 top-[max(0.75rem,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-white/85 text-forest"
        >
          <Icon name="back" />
        </Link>
        <div className="absolute right-4 top-[max(0.75rem,env(safe-area-inset-top))]">
          <SaveButton farmId={farm.id} initial={saved} signedIn={Boolean(viewer)} />
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 pt-5">
        <header className="flex flex-col gap-2">
          {farm.verified_at || farm.featured ? (
            <span className="flex flex-wrap gap-1.5">
              {farm.featured ? <FeaturedBadge label={t('featured.badge')} /> : null}
              {farm.verified_at ? <VerifiedBadge label={t('farm.verifiedLong')} /> : null}
            </span>
          ) : null}
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{farm.name}</h1>
          <p className="text-sm text-soil">{place}</p>
          {farm.rating && farm.rating.count > 0 ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Icon name="star" size={16} className="fill-amber text-amber" />
              {t('farmPage.rating', { avg: String(farm.rating.avg), n: farm.rating.count })}
            </p>
          ) : null}
          <ul className="flex flex-wrap gap-1.5">
            {farm.categories.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-sm font-semibold">
                <Icon name={CATEGORY_ICON[c] ?? 'leaf'} size={14} className="text-sprout-deep" />
                {catName(c)}
              </li>
            ))}
          </ul>
        </header>

        {!mine ? (
          <form action={message}>
            <button type="submit" className="btn-secondary">
              <Icon name="chat" size={18} />
              {t('orders.message')}
            </button>
          </form>
        ) : null}

        <dl className="grid grid-cols-3 gap-2">
          <Fact label={t('farm.farmer')} value={farm.farmer_name ?? '–'} />
          <Fact label={t('farm.since')} value={farm.year_started ? String(farm.year_started) : '–'} />
          <Fact label={t('farm.size')} value={farm.size_acres ? t('farm.acres', { n: Number(farm.size_acres) }) : '–'} />
        </dl>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{t('farm.offers')}</h2>
          {farm.listings.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mint text-sprout-deep">
                  <Icon name={CATEGORY_ICON[l.product?.category_slug ?? farm.categories[0]] ?? 'leaf'} size={22} />
                </span>
                <div className="min-w-0">
                  <h3 className="font-bold">{productName(l)}</h3>
                  {l.quantity ? (
                    <p className="text-sm tabular-nums text-soil">
                      {t('farm.available', { qty: `${formatQty(l.quantity)} ${t(`units.${l.unit}`)}` })}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                {l.price_kes !== null ? (
                  <>
                    <div className="font-bold tabular-nums">{kes(l.price_kes)}</div>
                    <div className="text-sm text-soil">{t('farm.per', { unit: t(`units.${l.unit}`) })}</div>
                  </>
                ) : (
                  <div className="text-sm text-soil">{t('farm.onRequest')}</div>
                )}
                {canOrder && l.status === 'active' && l.price_kes !== null && (l.quantity === null || l.quantity > 0) ? (
                  <CartStepper
                    farm={cartFarm}
                    listing={{
                      booking: l.type === 'experience',
                      id: l.id,
                      title: productName(l),
                      unit: t(`units.${l.unit}`),
                      price: Number(l.price_kes),
                      max: l.quantity === null ? null : Number(l.quantity),
                    }}
                  />
                ) : l.status === 'sold_out' ? (
                  <span className="rounded-full bg-mint px-2.5 py-1 text-xs font-bold text-soil">{t('cart.soldOut')}</span>
                ) : null}
              </div>
            </div>
          ))}
        </section>

        {farm.description ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">{t('farm.about')}</h2>
            <p className="leading-relaxed">{farm.description}</p>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{t('farmPage.reviews')}</h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-soil">{t('farmPage.noReviews')}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-2xl border border-line bg-surface p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-sm">{r.author_name ?? t('orders.buyer')}</b>
                    <Stars n={r.rating} label={t('orders.stars', { n: r.rating })} />
                  </div>
                  {r.body ? <p className="mt-1.5 text-sm leading-relaxed">{r.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{t('farm.location')}</h2>
          {hasPin ? (
            <FarmMiniMap
              id={farm.id}
              lng={farm.public_lng as number}
              lat={farm.public_lat as number}
              exact={farm.visibility === 'exact'}
              verified={Boolean(farm.verified_at)}
              label={`${t('farm.location')}: ${place}`}
            />
          ) : null}
          <p className="flex gap-2 text-sm text-soil">
            <Icon name="pin" size={16} className="mt-0.5 shrink-0 text-sprout-deep" />
            {farm.visibility === 'exact' ? t('farm.exactNote') : farm.visibility === 'hidden' ? t('farm.hiddenNote') : t('farm.approxNote')}
          </p>
        </section>
      </div>

      {canOrder ? <CartBar farmId={farm.id} /> : null}
      <ContactBar
        farmId={farm.id}
        farmName={farm.name}
        farmerName={farm.farmer_name}
        phone={farm.phone_public}
        whatsapp={farm.whatsapp}
        listingId={farm.listings[0]?.id ?? null}
        lng={farm.public_lng}
        lat={farm.public_lat}
      />
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <dt className="text-xs text-soil">{label}</dt>
      <dd className="mt-0.5 truncate font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Stars({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={14} className={i <= n ? 'fill-amber text-amber' : 'text-line'} />
      ))}
    </span>
  );
}

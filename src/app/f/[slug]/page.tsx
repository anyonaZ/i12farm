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
import { ReportFarm } from '@/components/farm/ReportFarm';
import { CartBar } from '@/components/cart/CartBar';
import { CartStepper } from '@/components/cart/CartStepper';
import { getFarmBySlug, isFarmSaved, listFarmReviews } from '@/domains/farms/queries';
import { priceBenchmarks } from '@/domains/insights/queries';
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
  if (!farm) return { title: (await getTranslations('titles'))('farmNotFound') };
  const place = [farm.place_name, farm.county?.name].filter(Boolean).join(', ');
  const image = publicMediaUrl(farm.media[0]?.storage_path);
  return {
    title: farm.name,
    description: `${place}. ${farm.description ?? ''}`.trim(),
    openGraph: {
      title: `${farm.name} · i12farm`,
      description: place,
      images: [image ?? { url: `/f/${farm.slug}/preview`, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function FarmPage({ params }: Params) {
  const { slug } = await params;
  const farm = await getFarmBySlug(slug);
  if (!farm) notFound();

  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const [categories, saved, viewer, reviews, benchmarks] = await Promise.all([
    listFarmCategories(locale),
    isFarmSaved(farm.id),
    getViewer(),
    listFarmReviews(farm.id, 6),
    priceBenchmarks(farm.id),
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
    <main className="pb-64 lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8 lg:pb-16 lg:pt-6">
      <FarmViewTracker farmId={farm.id} />
      <div className="relative aspect-[16/11] max-h-80 w-full overflow-hidden lg:aspect-auto lg:h-[420px] lg:max-h-none lg:rounded-3xl">
        {farm.media.length > 1 ? (
          <>
            <div className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] lg:hidden">
              {farm.media.map((m) => (
                <div key={m.id} className="h-full w-full shrink-0 snap-start">
                  <FarmCover id={farm.id} name={farm.name} category={farm.categories[0]} coverPath={m.storage_path} />
                </div>
              ))}
            </div>
            {/* Desktop: one large photo and up to four small ones, Airbnb-style */}
            <div className="hidden h-full grid-cols-4 grid-rows-2 gap-2 lg:grid">
              {farm.media.slice(0, 5).map((m, i) => (
                <div
                  key={m.id}
                  className={i === 0 ? 'col-span-2 row-span-2' : farm.media.length === 2 ? 'col-span-2 row-span-2' : 'overflow-hidden'}
                >
                  <FarmCover
                    id={farm.id}
                    name={farm.name}
                    category={farm.categories[0]}
                    coverPath={m.storage_path}
                    sizes="(min-width: 1024px) 600px, 100vw"
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <FarmCover id={farm.id} name={farm.name} category={farm.categories[0]} coverPath={farm.media[0]?.storage_path} />
        )}
        <Link
          href="/"
          aria-label={t('farm.back')}
          className="absolute left-4 top-[max(0.75rem,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-surface/85 text-forest"
        >
          <Icon name="back" />
        </Link>
        <div className="absolute right-4 top-[max(0.75rem,env(safe-area-inset-top))] flex gap-2">
          <ContactBar
            variant="share"
            farmId={farm.id}
            farmName={farm.name}
            farmerName={farm.farmer_name}
            phone={farm.phone_public}
            whatsapp={farm.whatsapp}
            listingId={farm.listings[0]?.id ?? null}
            lng={farm.public_lng}
            lat={farm.public_lat}
          />
          <SaveButton farmId={farm.id} initial={saved} signedIn={Boolean(viewer)} />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-12 lg:pt-8">
        <div className="flex flex-col gap-6 px-4 pt-5 lg:px-0 lg:pt-0">
          <header className="flex flex-col gap-2">
            {farm.verified_at || farm.featured ? (
              <span className="flex flex-wrap gap-1.5">
                {farm.featured ? <FeaturedBadge label={t('featured.badge')} /> : null}
                {farm.verified_at ? <VerifiedBadge label={t('farm.verifiedLong')} /> : null}
              </span>
            ) : null}
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight lg:text-4xl">{farm.name}</h1>
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

          {!mine && (farm.phone_public || farm.whatsapp) ? (
            <form action={message} className="lg:hidden">
              <button type="submit" className="btn-secondary">
                <Icon name="chat" size={18} />
                {t('orders.message')}
              </button>
            </form>
          ) : null}

          {farm.farmer_name || farm.year_started || farm.size_acres ? (
            <dl className="flex flex-wrap gap-2">
              {farm.farmer_name ? <Fact label={t('farm.farmer')} value={farm.farmer_name} /> : null}
              {farm.year_started ? <Fact label={t('farm.since')} value={String(farm.year_started)} /> : null}
              {farm.size_acres ? <Fact label={t('farm.size')} value={t('farm.acres', { n: Number(farm.size_acres) })} /> : null}
            </dl>
          ) : null}

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
                        {t('farm.available', {
                          qty: t.has(`unitCount.${l.unit}`)
                            ? t(`unitCount.${l.unit}` as never, { n: Number(l.quantity) } as never)
                            : `${formatQty(l.quantity)} ${t(`units.${l.unit}`)}`,
                        })}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                  {l.price_kes !== null ? (
                    <>
                      <div className="font-bold tabular-nums">{kes(l.price_kes)}</div>
                      <div className="text-sm text-soil">{t('farm.per', { unit: t(`units.${l.unit}`) })}</div>
                      {benchmarks[l.id] ? (
                        <Link
                          href={`/prices?${benchmarks[l.id].scope === 'county' ? `county=${farm.county_code}&` : ''}p=${l.product_slug ?? ''}&u=${l.unit}`}
                          title={t('prices.compareTitle', { n: benchmarks[l.id].farms })}
                          className="hit text-xs text-soil underline decoration-soil/40 underline-offset-2 hover:text-sprout-deep"
                        >
                          {t('prices.compare', { scope: benchmarks[l.id].scope, price: kes(benchmarks[l.id].median_kes) })}
                        </Link>
                      ) : null}
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
              {farm.visibility === 'exact'
                ? t('farm.exactNote')
                : farm.visibility === 'hidden'
                  ? t('farm.hiddenNote')
                  : t('farm.approxNote')}
            </p>
          </section>

          {!mine ? <ReportFarm farmId={farm.id} signedIn={Boolean(viewer)} back={`/f/${farm.slug}`} /> : null}
        </div>

        {/* Desktop side panel: order, message, contact. Phones use the bottom bars instead. */}
        <aside className="sticky top-24 hidden flex-col gap-4 rounded-3xl border border-line bg-surface p-6 shadow-[0_8px_30px_rgba(5,59,43,0.08)] lg:flex">
          <div>
            <p className="text-sm text-soil">{farm.farmer_name ?? farm.name}</p>
            {farm.listings.some((l) => l.price_kes !== null) ? (
              <p className="text-2xl font-extrabold tabular-nums">
                {kes(Math.min(...farm.listings.filter((l) => l.price_kes !== null).map((l) => Number(l.price_kes))))}
                <span className="ml-1.5 text-sm font-medium text-soil">{t('farm.from')}</span>
              </p>
            ) : null}
          </div>
          {canOrder ? <CartBar farmId={farm.id} variant="panel" /> : null}
          {!mine ? (
            <form action={message}>
              <button type="submit" className="btn-secondary">
                <Icon name="chat" size={18} />
                {t('orders.message')}
              </button>
            </form>
          ) : (
            <Link href="/my-farm" className="btn-secondary">
              {t('myFarm.title')}
            </Link>
          )}
          <div className="border-t border-line pt-4">
            <ContactBar
              variant="panel"
              farmId={farm.id}
              farmName={farm.name}
              farmerName={farm.farmer_name}
              phone={farm.phone_public}
              whatsapp={farm.whatsapp}
              listingId={farm.listings[0]?.id ?? null}
              lng={farm.public_lng}
              lat={farm.public_lat}
            />
          </div>
          {farm.verified_at ? (
            <p className="flex items-center gap-2 text-xs text-soil">
              <Icon name="badge" size={16} className="text-sprout-deep" />
              {t('farm.verifiedLong')}
            </p>
          ) : null}
        </aside>
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
        message={mine ? undefined : message}
        messageLabel={t('orders.message')}
      />
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[30%] flex-1 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <dt className="text-xs text-soil">{label}</dt>
      <dd className="mt-0.5 font-bold tabular-nums">{value}</dd>
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

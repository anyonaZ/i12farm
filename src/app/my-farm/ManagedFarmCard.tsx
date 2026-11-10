import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { FarmCover } from '@/components/farm/FarmCover';
import type { ManagedFarm } from '@/domains/farms/queries';
import type { Product } from '@/domains/reference/queries';
import type { Viewer } from '@/lib/auth/viewer';
import { kes } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { getPayoutAccount } from '@/domains/admin/disbursements';
import { ClaimCode, PhotoManager, StockEditor } from './FarmTools';
import { payoutWhere } from './payout-where';
import { PriceEditor } from './PriceEditor';
import { AddProduct, ListingControls, PauseFarm } from './ProductTools';

/** Everything a farmer or agent does to one farm: stats, earnings, prices, stock, products, photos. */
export async function ManagedFarmCard({
  farm: f,
  until,
  viewer,
  locale,
  products,
}: {
  farm: ManagedFarm;
  until: string | null;
  viewer: Viewer;
  locale: Locale;
  products: Product[];
}) {
  const t = await getTranslations();
  const format = await getFormatter();
  const isAgent = viewer.roles.includes('agent');
  const published = f.status === 'published';
  const offered = products.filter((p) => f.categories.includes(p.category));
  const payoutAccount = await getPayoutAccount(viewer, f.id).catch(() => null);
  return (
    <article className="card gap-3">
      <div className="flex items-center gap-3">
        <span className="size-16 shrink-0 overflow-hidden rounded-2xl">
          <FarmCover id={f.id} name={f.name} category={f.categories[0]} coverPath={f.media[0]?.storage_path} sizes="64px" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-snug">{f.name}</h3>
          <p className="truncate text-sm text-soil">{[f.place_name, f.county?.name].filter(Boolean).join(' · ')}</p>
        </div>
        <Link
          href={`/my-farm/${f.id}/edit`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-bold"
        >
          <Icon name="clipboard" size={16} />
          {t('farmEdit.edit')}
        </Link>
      </div>
      {!published ? (
        <p className="rounded-xl bg-amber/15 px-3 py-2.5 text-sm font-semibold">
          {f.status === 'suspended' ? t('farmEdit.suspended') : t('farmEdit.pausedFarm')}
        </p>
      ) : null}
      <dl className="grid grid-cols-3 gap-2">
        <Stat label={t('myFarm.views')} value={f.stats.views} />
        <Stat label={t('myFarm.calls')} value={f.stats.calls} />
        <Stat label={t('myFarm.whatsapps')} value={f.stats.whatsapps} />
      </dl>
      {f.balance.pending || f.balance.due || f.balance.paidOut ? (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-line p-3 text-sm">
          <h4 className="flex items-center gap-2 font-bold">
            <Icon name="wallet" size={18} className="text-sprout-deep" />
            {t('myFarmPlus.earnings')}
          </h4>
          <Money label={t('myFarmPlus.due')} value={f.balance.due} strong />
          <Money label={t('myFarmPlus.pending')} value={f.balance.pending} />
          <Money label={t('myFarmPlus.paidOut')} value={f.balance.paidOut} />
          <p className="text-xs text-soil">{t('myFarmPlus.payoutNote')}</p>
        </div>
      ) : null}
      <Link
        href={`/my-farm/${f.id}/payouts`}
        className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl px-3.5 text-sm font-bold ${
          payoutAccount ? 'border border-line' : 'bg-amber/15'
        }`}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Icon name="wallet" size={18} className="shrink-0 text-sprout-deep" />
          <span className="truncate">
            {payoutAccount ? t('payouts.paidTo', { where: payoutWhere(payoutAccount, (k) => t(`payouts.${k}`)) }) : t('payouts.addLink')}
          </span>
        </span>
        <span className="shrink-0 text-sprout-deep">{payoutAccount ? t('payouts.changeLink') : '›'}</span>
      </Link>
      <Link
        href={`/my-farm/feature/${f.id}`}
        className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl px-3.5 text-sm font-bold ${until ? 'bg-lime/40' : 'border border-line'}`}
      >
        <span className="inline-flex items-center gap-2">
          <Icon name="star" size={18} className={until ? 'fill-forest text-forest' : 'text-sprout-deep'} />
          {until
            ? t('featured.until', {
                date: format.dateTime(new Date(until), { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' }),
              })
            : t('featured.cta')}
        </span>
        <span className="text-sprout-deep">{until ? t('featured.extend') : '›'}</span>
      </Link>
      {isAgent && !f.claimed && f.managed_by === viewer.id ? <ClaimCode farmId={f.id} /> : null}
      {f.claimed && f.managed_by === viewer.id && f.owner_id !== viewer.id ? (
        <p className="flex items-center gap-2 text-sm text-soil">
          <Icon name="check" size={16} className="text-sprout-deep" />
          {t('myFarmPlus.claimedBy')}
        </p>
      ) : null}
      <h4 className="font-bold">{t('myFarm.productsTitle')}</h4>
      <div>
        {f.listings.length === 0 ? <p className="text-sm text-soil">{t('farmEdit.noProducts')}</p> : null}
        {f.listings.map((l) => {
          const label = l.product ? (locale === 'sw' ? l.product.name_sw : l.product.name_en) : l.title;
          return (
            <div key={l.id} className="border-t border-line first:border-t-0">
              <PriceEditor
                listingId={l.id}
                name={l.title && l.title !== l.product?.name_en ? l.title : label}
                unitLabel={t('farm.per', { unit: t(`units.${l.unit}` as never) })}
                price={l.price_kes === null ? null : Number(l.price_kes)}
                history={f.history[l.id] ?? []}
              />
              <StockEditor listingId={l.id} quantity={l.quantity === null ? null : Number(l.quantity)} label={label} />
              <ListingControls listingId={l.id} status={l.status} label={label} />
            </div>
          );
        })}
      </div>
      <AddProduct farmId={f.id} products={offered.map((p) => ({ slug: p.slug, name: p.name, unit: p.unit }))} />
      <PhotoManager farmId={f.id} photos={f.media} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href={`/f/${f.slug}`} className="btn-secondary">
          {t('myFarm.viewPublic')}
        </Link>
        {f.status !== 'suspended' ? <PauseFarm farmId={f.id} published={published} /> : null}
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col-reverse rounded-2xl bg-mint p-3">
      <dt className="text-xs text-soil">{label}</dt>
      <dd className="text-[22px] font-extrabold tabular-nums">{value}</dd>
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={strong ? 'font-semibold' : 'text-soil'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-extrabold' : ''}`}>{kes(value)}</span>
    </div>
  );
}

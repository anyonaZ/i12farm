import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Viewer } from '@/lib/auth/viewer';
import { withUser } from '@/lib/db';
import { ResolveReportButtons } from './ReportControls';

interface Reported {
  farm_id: string;
  name: string;
  slug: string;
  status: string;
  reports: number;
  reasons: string[];
  notes: string[];
}

/** Admin → Farms: farms with open reports, most reported first. */
export async function ReportedFarms({ viewer }: { viewer: Viewer }) {
  const t = await getTranslations('report');
  const rows = await withUser(
    viewer.id,
    (tx) => tx<Reported[]>`
    select f.id as farm_id, f.name, f.slug, f.status::text as status, count(*)::int as reports,
           array_agg(distinct r.reason) as reasons,
           array_remove(array_agg(r.note order by r.created_at desc), null) as notes
    from public.farm_reports r join public.farms f on f.id = r.farm_id
    where r.resolved_at is null
    group by f.id order by count(*) desc, max(r.created_at) desc limit 50`,
  );
  return (
    <section className="card gap-3">
      <h2 className="text-lg font-bold">{t('adminTitle')}</h2>
      {rows.length === 0 ? <p className="text-sm text-soil">{t('adminNone')}</p> : null}
      {rows.map((r) => (
        <div key={r.farm_id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/f/${r.slug}`} className="font-bold underline">
              {r.name}
            </Link>
            <span className="text-sm text-soil">
              {t('reports', { n: r.reports })}
              {r.status === 'suspended' ? (
                <b className="ml-2 rounded-full bg-amber/20 px-2 py-0.5 text-xs text-forest">{t('adminHidden')}</b>
              ) : null}
            </span>
          </div>
          <p className="text-sm">{r.reasons.map((x) => t(`reason_${x}` as never)).join(' · ')}</p>
          {r.notes.slice(0, 3).map((n, i) => (
            <p key={i} className="rounded-xl bg-mint px-3 py-2 text-sm">
              “{n}”
            </p>
          ))}
          <ResolveReportButtons farmId={r.farm_id} hidden={r.status === 'suspended'} />
        </div>
      ))}
    </section>
  );
}

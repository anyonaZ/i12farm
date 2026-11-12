import { titled } from '@/lib/titles';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { COUNTY_FOCUS, listCounties, listFarmCategories, listPilotSubCounties } from '@/domains/reference/queries';
import { getFarmForEdit } from '@/domains/farms/queries';
import { requireViewer } from '@/lib/auth/viewer';
import { displayPhone } from '@/lib/phone';
import type { Locale } from '@/i18n/config';
import { EditFarmForm } from './EditFarmForm';

export const generateMetadata = titled('editFarm', { robots: { index: false } });

export default async function EditFarmPage({ params }: { params: Promise<{ farmId: string }> }) {
  const { farmId } = await params;
  const viewer = await requireViewer(`/my-farm/${farmId}/edit`);
  const locale = (await getLocale()) as Locale;
  const [farm, categories, counties, subCounties] = await Promise.all([
    getFarmForEdit(viewer.id, farmId),
    listFarmCategories(locale),
    listCounties(),
    listPilotSubCounties(),
  ]);
  if (!farm) notFound();
  return (
    <EditFarmForm
      farm={{
        ...farm,
        phone_public: farm.phone_public ? displayPhone(farm.phone_public) : '',
        whatsapp: farm.whatsapp ? displayPhone(farm.whatsapp) : '',
      }}
      categories={(categories ?? []).map((c) => ({ slug: c.slug, name: c.name }))}
      counties={(counties ?? []).map((c) => ({ ...c, focus: COUNTY_FOCUS[c.code] ?? null }))}
      subCounties={subCounties}
    />
  );
}

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { Locale } from '@/i18n/config';

export interface FarmCategory {
  slug: string;
  name: string;
  icon: string;
}

export interface County {
  code: number;
  name: string;
}

export async function listFarmCategories(locale: Locale): Promise<FarmCategory[] | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('farm_categories')
    .select('slug, name_en, name_sw, icon')
    .eq('active', true)
    .order('sort_order');
  if (error || !data) return null;
  return data.map((c) => ({ slug: c.slug, icon: c.icon, name: locale === 'sw' ? c.name_sw : c.name_en }));
}

export async function listCounties(): Promise<County[] | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('counties').select('code, name').order('name');
  if (error || !data) return null;
  return data;
}

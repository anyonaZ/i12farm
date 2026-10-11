import { supabaseUrl } from '@/lib/env';

export const FARM_MEDIA_BUCKET = 'farm-media';

export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${supabaseUrl}/storage/v1/object/public/${FARM_MEDIA_BUCKET}/${path}`;
}

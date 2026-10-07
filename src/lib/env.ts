// Supabase now issues "publishable" keys; older projects use the anon key.
// Either works with RLS, so accept both names.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

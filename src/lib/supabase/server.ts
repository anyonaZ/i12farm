import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseKey, supabaseUrl } from '@/lib/env';

// One client per request. Uses the signed-in user's session, so every query
// runs under row-level security as that user (never a service key).
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

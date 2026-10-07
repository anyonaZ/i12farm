import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Completes Google and email-link sign-in (PKCE code exchange).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/my-farm';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/my-farm';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await supabase.from('events').insert({
        name: 'auth.signed_in',
        user_id: data.user?.id ?? null,
        anonymous_id: data.user ? null : 'server',
        properties: { provider: data.user?.app_metadata?.provider ?? 'unknown' },
        path: '/auth/callback',
      });
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/sign-in?error=callback`);
}

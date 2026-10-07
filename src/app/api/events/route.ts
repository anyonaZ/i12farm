import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { isEventName, MAX_BATCH, type EventBatch } from '@/lib/analytics/events';

// Receives batches from the client tracker and appends them to public.events.
// Runs as the visitor (RLS applies): user_id is taken from the session, never
// from the request body, and the database rejects anything else.

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function deviceClass(ua: string): string {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

function cleanProperties(input: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return new NextResponse(null, { status: 204 });

  let body: Partial<EventBatch>;
  try {
    const text = await request.text();
    if (text.length > 32_000) return NextResponse.json({ error: 'too large' }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const anonymousId = typeof body.anonymous_id === 'string' && ID_RE.test(body.anonymous_id) ? body.anonymous_id : null;
  const sessionId = typeof body.session_id === 'string' && ID_RE.test(body.session_id) ? body.session_id : null;
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  if (!anonymousId || events.length === 0) {
    return NextResponse.json({ error: 'nothing to record' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;

  let countyCode: number | null = null;
  if (userId) {
    const { data: profile } = await supabase.from('profiles').select('county_code').eq('id', userId).maybeSingle();
    countyCode = profile?.county_code ?? null;
  }

  const device = deviceClass(request.headers.get('user-agent') ?? '');
  const locale = body.locale === 'sw' ? 'sw' : 'en';
  const appVersion = typeof body.app_version === 'string' ? body.app_version.slice(0, 20) : null;

  const rows = events
    .filter((e) => e && isEventName(e.name))
    .map((e) => ({
      name: e.name,
      occurred_at: typeof e.occurred_at === 'string' && !Number.isNaN(Date.parse(e.occurred_at)) ? e.occurred_at : undefined,
      user_id: userId,
      anonymous_id: anonymousId,
      session_id: sessionId,
      properties: cleanProperties(e.properties),
      county_code: countyCode,
      path: typeof e.path === 'string' ? e.path.slice(0, 300) : null,
      device,
      locale,
      app_version: appVersion,
    }));

  if (rows.length === 0) return NextResponse.json({ error: 'unknown events' }, { status: 400 });

  const { error } = await supabase.from('events').insert(rows);
  if (error) {
    console.error('events insert failed', error.message);
    return NextResponse.json({ error: 'not recorded' }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

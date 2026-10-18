import { NextResponse, type NextRequest } from 'next/server';
import { currentUserId } from '@/lib/auth/session';
import { withUser } from '@/lib/db';
import { allow, clientIp } from '@/lib/rate-limit';

const CHANNELS = new Set(['call', 'whatsapp', 'sms', 'directions', 'share']);
const UUID_RE = /^[0-9a-f-]{36}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

// A buyer tapped Call / WhatsApp / Directions / Share on a farm page. Sent
// with keepalive just before the phone app opens. RLS only accepts taps on
// published farms, and actor_id defaults to the signed-in user.
export async function POST(request: NextRequest) {
  if (!allow(`contact:${clientIp(request.headers)}`, 30, 60_000)) return new NextResponse(null, { status: 429 });
  let body: { farm_id?: string; listing_id?: string | null; channel?: string; anonymous_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.farm_id || !UUID_RE.test(body.farm_id) || !body.channel || !CHANNELS.has(body.channel)) {
    return NextResponse.json({ error: 'bad tap' }, { status: 400 });
  }
  const listingId = body.listing_id && UUID_RE.test(body.listing_id) ? body.listing_id : null;
  const anonymousId = body.anonymous_id && ID_RE.test(body.anonymous_id) ? body.anonymous_id : null;
  try {
    await withUser(
      await currentUserId(),
      (tx) => tx`
      insert into public.contact_events (farm_id, listing_id, channel, anonymous_id)
      values (${body.farm_id!}, ${listingId}, ${body.channel!}, ${anonymousId})`,
    );
  } catch {
    return NextResponse.json({ error: 'not recorded' }, { status: 422 });
  }
  return new NextResponse(null, { status: 204 });
}

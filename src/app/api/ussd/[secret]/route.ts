import { NextResponse, type NextRequest } from 'next/server';
import { isUssdSecret } from '@/lib/sms';
import { allow } from '@/lib/rate-limit';
import { handleUssd } from '@/domains/ussd/handler';
import { dispatchSoon } from '@/domains/notifications/dispatch';

// Africa's Talking USSD callback (USSD → Service codes → Callback URL).
// Form fields: sessionId, serviceCode, phoneNumber, networkCode, text.
// Reply in plain text starting with "CON " (show a menu) or "END " (close).
export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  if (!isUssdSecret((await params).secret)) return new NextResponse(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const phone = String(form?.get('phoneNumber') ?? '');
  const text = String(form?.get('text') ?? '');
  const sessionId = String(form?.get('sessionId') ?? '');
  let reply: string;
  if (!allow(`ussd:${phone}`, 60, 60_000)) {
    reply = 'END Too many requests. Try again in a minute.';
  } else {
    reply = await handleUssd({ phone, text, sessionId }).catch((error) => {
      console.error('[ussd]', error);
      return 'END Sorry, something went wrong. Please try again.';
    });
    dispatchSoon();
  }
  return new NextResponse(reply, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

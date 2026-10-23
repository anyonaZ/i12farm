import { NextResponse, type NextRequest } from 'next/server';
import { isSmsCallbackSecret } from '@/lib/sms';
import { handleInboundSms } from '@/domains/notifications/dispatch';

// Incoming SMS to our short code (AT: SMS → Incoming Messages callback).
// Form fields: from, to, text, date, id, linkId. Only STOP / START matter for now.
export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  if (!isSmsCallbackSecret((await params).secret)) return new NextResponse(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const from = form?.get('from');
  const text = form?.get('text');
  if (typeof from === 'string' && typeof text === 'string') await handleInboundSms(from, text);
  return new NextResponse(null, { status: 200 });
}

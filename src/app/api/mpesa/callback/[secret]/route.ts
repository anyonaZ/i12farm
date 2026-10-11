import { NextResponse, type NextRequest } from 'next/server';
import { applyResult } from '@/domains/orders/payments';
import { isCallbackSecret, parseCallback } from '@/lib/mpesa';

// Daraja posts the STK result here. Always answer 200 with ResultCode 0 so
// Safaricom stops retrying; the work is idempotent in record_payment_result().
const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };

export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  if (!isCallbackSecret((await params).secret)) return new NextResponse(null, { status: 404 });
  const raw = await request.json().catch(() => null);
  const cb = parseCallback(raw);
  if (!cb) return NextResponse.json(ACK);
  try {
    const result = await applyResult(cb, raw, true);
    if (result === 'unknown') console.warn('M-Pesa callback for unknown CheckoutRequestID', cb.checkoutRequestId);
  } catch (error) {
    console.error('M-Pesa callback failed', (error as Error).message);
    // A 500 makes Daraja retry, which is what we want if the database blipped.
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Retry' }, { status: 500 });
  }
  return NextResponse.json(ACK);
}

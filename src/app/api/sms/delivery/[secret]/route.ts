import { NextResponse, type NextRequest } from 'next/server';
import { isSmsCallbackSecret } from '@/lib/sms';
import { recordDelivery } from '@/domains/notifications/dispatch';

// Africa's Talking delivery reports (set this URL under SMS → Delivery Reports).
// Form fields: id, status, phoneNumber, networkCode, failureReason, retryCount.
export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  if (!isSmsCallbackSecret((await params).secret)) return new NextResponse(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const id = form?.get('id');
  const status = form?.get('status');
  if (typeof id === 'string' && typeof status === 'string') {
    const reason = form?.get('failureReason');
    await recordDelivery(id, status, typeof reason === 'string' && reason ? reason : null);
  }
  return new NextResponse(null, { status: 200 });
}

import { NextResponse, type NextRequest } from 'next/server';
import { applyDisbursementResult } from '@/domains/admin/disbursements';
import { applyResult } from '@/domains/orders/payments';
import { isCallbackSecret, parseCallback } from '@/lib/pesi';
import { kickPush } from '@/lib/push';

// Pesi posts every status change here: collections (our references start
// I12P) and payouts/refunds (I12D). Registered once per Pesi account with
// scripts/pesi-register-callback.mjs. The work is idempotent in the database,
// so answering 200 to repeats is safe; a 500 asks Pesi to try again.
export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  if (!isCallbackSecret((await params).secret)) return new NextResponse(null, { status: 404 });
  const raw = await request.json().catch(() => null);
  const result = parseCallback(raw);
  kickPush(); // a paid order or a payout tells someone
  if (!result) return NextResponse.json({ received: true });
  try {
    const verdict = result.partnerTransactionId.startsWith('I12D')
      ? await applyDisbursementResult(result, raw, true)
      : await applyResult(result, raw, true);
    if (verdict === 'unknown') console.warn('Pesi callback for an unknown reference', result.partnerTransactionId);
  } catch (error) {
    console.error('Pesi callback failed', (error as Error).message);
    return NextResponse.json({ received: false }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

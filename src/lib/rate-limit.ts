import 'server-only';

// Small in-memory limiter: N hits per window per key. Good enough on one
// server (the recommended VM); on serverless hosts each instance counts on
// its own, so it only blunts floods. Sign-in throttling lives in the database.

const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, hits] of buckets) if (!hits.length || hits[hits.length - 1] < now - 3_600_000) buckets.delete(k);
    lastSweep = now;
  }
  const hits = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}

// Runs once when the server starts. Starts the SMS sender loop on Node
// servers (a VM or container). On serverless hosts the loop does not survive
// between requests; use /api/cron/sms there instead. SMS_WORKER=off disables it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SMS_WORKER === 'off' || !process.env.DATABASE_URL) return;
  const { dispatchQueued } = await import('./domains/notifications/dispatch');
  const tick = () => dispatchQueued().catch((error) => console.error('[sms] dispatch failed', error));
  const timer = setInterval(tick, Number(process.env.SMS_WORKER_INTERVAL_MS ?? 30_000));
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}

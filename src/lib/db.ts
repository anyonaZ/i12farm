import 'server-only';
import postgres from 'postgres';

// One Postgres pool per server process. Every user-facing query runs inside
// withUser(), which switches to the `anon` or `authenticated` role and sets
// app.user_id for that transaction only, so row-level security applies
// exactly as the migrations describe. Auth bookkeeping (users, sessions)
// uses getSql() directly as the owner role and never touches user data.

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

declare global {
  var __i12farmSql: Sql | undefined;
}

export const isDbConfigured = Boolean(process.env.DATABASE_URL);

export function getSql(): Sql {
  if (!globalThis.__i12farmSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');
    globalThis.__i12farmSql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      // Transaction-mode poolers (Neon "-pooler", PgBouncer) need prepared statements off.
      prepare: process.env.DATABASE_PREPARE !== 'false',
      onnotice: () => undefined,
      connection: { application_name: 'i12farm' },
      types: {
        // numeric and bigint come back as JS numbers (prices are whole KES; counts are small).
        numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
        bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      },
    });
  }
  return globalThis.__i12farmSql;
}

/** Run queries as a user (or as an anonymous visitor when userId is null), under RLS. */
export async function withUser<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await getSql().begin(async (tx) => {
    await tx`select set_config('role', ${userId ? 'authenticated' : 'anon'}, true),
                    set_config('app.user_id', ${userId ?? ''}, true)`;
    return fn(tx);
  });
  return result as T;
}

/** Postgres error → short message safe to show (raised with our own wording in the functions). */
export function dbMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as { message: string; code?: string };
    if (e.code && /^(P0001|P0002|22023|23505|42501|54000)$/.test(e.code)) return e.message;
    if (e.code === '23514') return 'That value is not allowed';
    if (e.code === '23503') return 'Unknown reference';
  }
  return 'unexpected error';
}

import 'server-only';
import type { Tx } from '@/lib/db';
import type { EventName } from './events';

// Server-side events go through the same table and RLS rule as the browser
// tracker: user_id is either the signed-in user or null.
export async function recordEvent(
  tx: Tx,
  e: {
    name: EventName;
    userId: string | null;
    properties?: Record<string, string | number | boolean | null>;
    countyCode?: number | null;
    path?: string;
  },
): Promise<void> {
  await tx`
    insert into public.events (name, user_id, anonymous_id, properties, county_code, path)
    values (${e.name}, ${e.userId}, ${e.userId ? null : 'server'}, ${tx.json(e.properties ?? {})},
            ${e.countyCode ?? null}, ${e.path ?? null})`;
}

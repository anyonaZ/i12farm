import 'server-only';
import { getSql } from '@/lib/db';
import type { Viewer } from '@/lib/auth/viewer';

export interface SessionRow {
  id: string;
  method: string;
  created_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  current: boolean;
}

/** The viewer's active sessions (devices), newest first. */
export async function listMySessions(viewer: Viewer): Promise<SessionRow[]> {
  return getSql()<SessionRow[]>`
    select id, method, created_at, last_seen_at, user_agent, id = ${viewer.sessionId} as current
    from auth.sessions
    where user_id = ${viewer.id} and revoked_at is null and expires_at > now()
    order by last_seen_at desc
    limit 10`;
}

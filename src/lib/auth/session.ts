import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { getSql, isDbConfigured } from '@/lib/db';
import { siteUrl } from '@/lib/env';

// Sessions: a random 32-byte token in an httpOnly cookie; the database keeps
// only its SHA-256. A session lasts 30 days from last use (checked on every
// request, extended at most once an hour) and never more than 180 days.

export const SESSION_COOKIE = 'i12f_session';
const IDLE_DAYS = 30;
const ABSOLUTE_DAYS = 180;

export type SignInMethod = 'password' | 'google' | 'email_link' | 'admin_link' | 'sign_up';

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

const secureCookies = siteUrl.startsWith('https://');

export async function requestInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  const ip = forwarded && /^[0-9a-f.:]+$/i.test(forwarded) ? forwarded : null;
  return { ip, userAgent: h.get('user-agent')?.slice(0, 300) ?? null };
}

/** Start a session for a user and set the cookie. Call from a server action or route handler. */
export async function startSession(userId: string, method: SignInMethod): Promise<void> {
  const token = newToken();
  const { ip, userAgent } = await requestInfo();
  const sql = getSql();
  await sql`
    insert into auth.sessions (user_id, token_hash, method, expires_at, user_agent, ip)
    values (${userId}, ${hashToken(token)}, ${method}, now() + make_interval(days => ${IDLE_DAYS}), ${userAgent}, ${ip})`;
  await sql`update auth.users set last_sign_in_at = now() where id = ${userId}`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_DAYS * 24 * 60 * 60,
  });
}

export interface Session {
  id: string;
  userId: string;
}

/** The current session, or null. Cached for the duration of one request. */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!isDbConfigured) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 100) return null;
  const sql = getSql();
  const [row] = await sql<{ id: string; user_id: string; stale: boolean }[]>`
    select s.id, s.user_id, s.last_seen_at < now() - interval '1 hour' as stale
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and s.created_at > now() - make_interval(days => ${ABSOLUTE_DAYS})
      and u.status = 'active'`;
  if (!row) return null;
  if (row.stale) {
    // Sliding expiry; fire and forget so page loads don't wait on it.
    sql`update auth.sessions set last_seen_at = now(), expires_at = now() + make_interval(days => ${IDLE_DAYS})
        where id = ${row.id}`.catch(() => undefined);
  }
  return { id: row.id, userId: row.user_id };
});

/** Signed-in user id, or null. */
export async function currentUserId(): Promise<string | null> {
  return (await getSession())?.userId ?? null;
}

/** End the current session (kept as a revoked row) and clear the cookie. */
export async function endSession(reason = 'signed_out'): Promise<string | null> {
  const session = await getSession();
  if (session) {
    await getSql()`update auth.sessions set revoked_at = now(), revoked_reason = ${reason} where id = ${session.id}`;
  }
  (await cookies()).delete(SESSION_COOKIE);
  return session?.userId ?? null;
}

export async function revokeOtherSessions(userId: string, keepId: string | null, reason: string): Promise<number> {
  const rows = await getSql()`
    update auth.sessions set revoked_at = now(), revoked_reason = ${reason}
    where user_id = ${userId} and revoked_at is null and (${keepId}::uuid is null or id <> ${keepId}::uuid)
    returning id`;
  return rows.length;
}

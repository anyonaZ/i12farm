import 'server-only';
import { getSql } from '@/lib/db';
import { siteUrl } from '@/lib/env';
import { toInternational } from '@/lib/phone';
import { hashPassword, verifyPassword } from './password';
import { hashToken, newToken } from './session';

// Account rules in one place: who can sign in, how attempts are throttled,
// how one-time links and Google accounts map to users. Runs as the database
// owner on the auth schema only.

export type Identifier = { kind: 'phone'; value: string } | { kind: 'email'; value: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseIdentifier(raw: string): Identifier | null {
  const input = (raw ?? '').trim();
  if (input.includes('@')) {
    const email = input.toLowerCase();
    return EMAIL_RE.test(email) && email.length <= 254 ? { kind: 'email', value: email } : null;
  }
  const phone = toInternational(input);
  return phone ? { kind: 'phone', value: phone } : null;
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? '').trim().toLowerCase();
  return email && EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

// ---------------------------------------------------------------------------
// Throttling: 5 wrong passwords per account per 15 minutes, 30 per IP.
// ---------------------------------------------------------------------------
const WINDOW = '15 minutes';

export async function isThrottled(identifier: string, ip: string | null): Promise<boolean> {
  const [row] = await getSql()<{ by_id: number; by_ip: number }[]>`
    select
      (select count(*)::int from auth.sign_in_attempts
        where identifier = ${identifier} and not success and at > now() - ${WINDOW}::interval) as by_id,
      (select count(*)::int from auth.sign_in_attempts
        where ${ip}::inet is not null and ip = ${ip}::inet and not success and at > now() - ${WINDOW}::interval) as by_ip`;
  return row.by_id >= 5 || row.by_ip >= 30;
}

export async function recordAttempt(a: {
  identifier: string;
  method: string;
  success: boolean;
  reason?: string;
  userId?: string | null;
  ip: string | null;
}): Promise<void> {
  await getSql()`
    insert into auth.sign_in_attempts (identifier, method, success, reason, user_id, ip)
    values (${a.identifier}, ${a.method}, ${a.success}, ${a.reason ?? null}, ${a.userId ?? null}, ${a.ip}::inet)`;
}

// ---------------------------------------------------------------------------
// Password sign-in and sign-up
// ---------------------------------------------------------------------------
export type SignInError = 'badCredentials' | 'tooMany' | 'suspended';

export async function signInWithPassword(
  id: Identifier,
  password: string,
  ip: string | null,
): Promise<{ ok: true; userId: string } | { ok: false; error: SignInError }> {
  if (await isThrottled(id.value, ip)) {
    await recordAttempt({ identifier: id.value, method: 'password', success: false, reason: 'throttled', ip });
    return { ok: false, error: 'tooMany' };
  }
  const sql = getSql();
  const [user] =
    id.kind === 'email'
      ? await sql<{ id: string; password_hash: string | null; status: string }[]>`
          select id, password_hash, status from auth.users where email = ${id.value}`
      : await sql<{ id: string; password_hash: string | null; status: string }[]>`
          select id, password_hash, status from auth.users where phone = ${id.value}`;

  const valid = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !valid) {
    await recordAttempt({
      identifier: id.value,
      method: 'password',
      success: false,
      reason: user ? 'wrong_password' : 'no_account',
      userId: user?.id,
      ip,
    });
    return { ok: false, error: 'badCredentials' };
  }
  if (user.status !== 'active') {
    await recordAttempt({ identifier: id.value, method: 'password', success: false, reason: 'suspended', userId: user.id, ip });
    return { ok: false, error: 'suspended' };
  }
  await recordAttempt({ identifier: id.value, method: 'password', success: true, userId: user.id, ip });
  return { ok: true, userId: user.id };
}

export type SignUpError = 'phoneTaken' | 'emailTaken';

export async function createAccount(input: {
  fullName: string;
  phone: string; // 2547XXXXXXXX
  email: string | null;
  password: string;
  locale: 'en' | 'sw';
  consentVersion: string;
}): Promise<{ ok: true; userId: string } | { ok: false; error: SignUpError }> {
  const sql = getSql();
  const hash = await hashPassword(input.password);
  try {
    const userId = await sql.begin(async (tx) => {
      const [taken] = await tx<{ phone: boolean; email: boolean }[]>`
        select exists (select 1 from auth.users where phone = ${input.phone}) as phone,
               exists (select 1 from auth.users where ${input.email}::text is not null and email = ${input.email}) as email`;
      if (taken.phone) throw new AccountTaken('phoneTaken');
      if (taken.email) throw new AccountTaken('emailTaken');
      const [user] = await tx<{ id: string }[]>`
        insert into auth.users (phone, email, password_hash, password_changed_at, meta)
        values (${input.phone}, ${input.email}, ${hash}, now(),
                ${tx.json({ full_name: input.fullName, locale: input.locale })})
        returning id`;
      await tx`update public.profiles set consent_version = ${input.consentVersion}, consent_at = now() where id = ${user.id}`;
      return user.id;
    });
    return { ok: true, userId: userId as string };
  } catch (error) {
    if (error instanceof AccountTaken) return { ok: false, error: error.reason };
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'phoneTaken' };
    throw error;
  }
}

class AccountTaken extends Error {
  constructor(public reason: SignUpError) {
    super(reason);
  }
}

export async function setPassword(userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await getSql()`update auth.users set password_hash = ${hash}, password_changed_at = now() where id = ${userId}`;
}

export async function checkPassword(userId: string, password: string): Promise<boolean> {
  const [row] = await getSql()<{ password_hash: string | null }[]>`select password_hash from auth.users where id = ${userId}`;
  return verifyPassword(password, row?.password_hash ?? null);
}

// ---------------------------------------------------------------------------
// One-time sign-in links (email, or issued by an admin)
// ---------------------------------------------------------------------------
export async function createSignInLink(userId: string, purpose: 'email_link' | 'admin_link', createdBy: string | null): Promise<string> {
  const token = newToken();
  const hours = purpose === 'email_link' ? 1 : 48;
  await getSql()`
    insert into auth.one_time_tokens (user_id, purpose, token_hash, created_by, expires_at)
    values (${userId}, ${purpose}, ${hashToken(token)}, ${createdBy}, now() + make_interval(hours => ${hours}))`;
  return `${siteUrl}/auth/link?token=${token}`;
}

export async function consumeSignInLink(
  token: string,
): Promise<{ ok: true; userId: string; purpose: 'email_link' | 'admin_link' } | { ok: false }> {
  if (!token || token.length > 100) return { ok: false };
  const sql = getSql();
  const [row] = await sql<{ user_id: string; purpose: 'email_link' | 'admin_link'; status: string }[]>`
    update auth.one_time_tokens t set used_at = now()
    from auth.users u
    where t.token_hash = ${hashToken(token)} and t.used_at is null and t.expires_at > now()
      and u.id = t.user_id
    returning t.user_id, t.purpose, u.status`;
  if (!row || row.status !== 'active') return { ok: false };
  if (row.purpose === 'email_link') {
    await sql`update auth.users set email_verified_at = coalesce(email_verified_at, now()) where id = ${row.user_id}`;
  }
  return { ok: true, userId: row.user_id, purpose: row.purpose };
}

/** Find or create the account for an email sign-in link. Returns null when rate-limited. */
export async function userForEmailLink(email: string, ip: string | null, locale: 'en' | 'sw'): Promise<string | null> {
  const sql = getSql();
  const [limits] = await sql<{ by_email: number; by_ip: number }[]>`
    select
      (select count(*)::int from auth.one_time_tokens t join auth.users u on u.id = t.user_id
        where u.email = ${email} and t.purpose = 'email_link' and t.created_at > now() - interval '1 hour') as by_email,
      (select count(*)::int from auth.sign_in_attempts
        where ${ip}::inet is not null and ip = ${ip}::inet and method = 'email_link_request' and at > now() - interval '1 hour') as by_ip`;
  await recordAttempt({ identifier: email, method: 'email_link_request', success: true, ip });
  if (limits.by_email >= 3 || limits.by_ip >= 20) return null;

  const [existing] = await sql<{ id: string; status: string }[]>`select id, status from auth.users where email = ${email}`;
  if (existing) return existing.status === 'active' ? existing.id : null;
  const [created] = await sql<{ id: string }[]>`
    insert into auth.users (email, meta) values (${email}, ${sql.json({ locale })}) returning id`;
  return created.id;
}

// ---------------------------------------------------------------------------
// Google
// A verified Google email proves ownership of that address. If an account
// already uses the address but never proved it, its password is dropped and
// its sessions ended, so nobody who registered someone else's email keeps access.
// ---------------------------------------------------------------------------
export async function userForGoogle(profile: {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  locale: 'en' | 'sw';
}): Promise<{ ok: true; userId: string } | { ok: false; error: 'suspended' | 'noEmail' }> {
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const [linked] = await tx<{ user_id: string; status: string }[]>`
      select i.user_id, u.status from auth.identities i join auth.users u on u.id = i.user_id
      where i.provider = 'google' and i.provider_user_id = ${profile.sub}`;
    if (linked) {
      await tx`update auth.identities set last_used_at = now(), email = ${profile.email}
               where provider = 'google' and provider_user_id = ${profile.sub}`;
      return linked.status === 'active'
        ? { ok: true as const, userId: linked.user_id }
        : { ok: false as const, error: 'suspended' as const };
    }

    const email = profile.emailVerified ? normaliseEmail(profile.email) : null;
    if (!email) return { ok: false as const, error: 'noEmail' as const };

    const [byEmail] = await tx<{ id: string; status: string; verified: boolean }[]>`
      select id, status, email_verified_at is not null as verified from auth.users where email = ${email} for update`;
    let userId: string;
    if (byEmail) {
      if (byEmail.status !== 'active') return { ok: false as const, error: 'suspended' as const };
      userId = byEmail.id;
      if (!byEmail.verified) {
        await tx`update auth.users set email_verified_at = now(), password_hash = null where id = ${userId}`;
        await tx`update auth.sessions set revoked_at = now(), revoked_reason = 'email_claimed_by_google'
                 where user_id = ${userId} and revoked_at is null`;
        await tx`insert into auth.audit_log (actor_id, target_id, action, details)
                 values (${userId}, ${userId}, 'google.claimed_unverified_email', ${tx.json({ email })})`;
      }
    } else {
      const [created] = await tx<{ id: string }[]>`
        insert into auth.users (email, email_verified_at, meta)
        values (${email}, now(), ${tx.json({ full_name: profile.name ?? '', locale: profile.locale })})
        returning id`;
      userId = created.id;
    }
    await tx`insert into auth.identities (provider, provider_user_id, user_id, email)
             values ('google', ${profile.sub}, ${userId}, ${email})`;
    return { ok: true as const, userId };
  });
  return result as { ok: true; userId: string } | { ok: false; error: 'suspended' | 'noEmail' };
}

export async function audit(actorId: string | null, targetId: string | null, action: string, details: Record<string, unknown> = {}) {
  const sql = getSql();
  await sql`insert into auth.audit_log (actor_id, target_id, action, details)
            values (${actorId}, ${targetId}, ${action}, ${sql.json(details as never)})`;
}

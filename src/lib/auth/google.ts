import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { siteUrl } from '@/lib/env';

// "Continue with Google": OAuth 2.0 authorization code flow with PKCE,
// written against Google's documented endpoints (no SDK). The ID token is
// taken straight from Google's token endpoint over TLS, which OpenID Connect
// allows us to trust without fetching signing keys (OIDC Core §3.1.3.7);
// we still check issuer, audience and expiry.
//
// Setup: Google Cloud console → APIs & Services → Credentials → OAuth client
// ID (Web application). Authorised redirect URI: <site>/auth/google/callback.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const OAUTH_COOKIE = 'i12f_oauth';
export const isGoogleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const redirectUri = () => `${siteUrl}/auth/google/callback`;
const b64url = (buf: Buffer) => buf.toString('base64url');

export function startGoogle(next: string): { url: string; cookie: string } {
  const state = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${AUTH_URL}?${params}`, cookie: JSON.stringify({ state, verifier, next }) };
}

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export async function finishGoogle(code: string, verifier: string): Promise<GoogleProfile | null> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const { id_token: idToken } = (await response.json()) as { id_token?: string };
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issuerOk || claims.aud !== process.env.GOOGLE_CLIENT_ID || !claims.sub || (claims.exp ?? 0) * 1000 < Date.now()) {
    return null;
  }
  return {
    sub: claims.sub,
    email: claims.email ?? null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name ?? null,
  };
}

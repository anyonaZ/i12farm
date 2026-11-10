#!/usr/bin/env node
// Registers i12farm's callback URL with Pesi for one account.
// Pesi accepts this ONCE per account (changing it needs their support team),
// so run it only when the final https domain is live:
//
//   node --env-file=.env.local scripts/pesi-register-callback.mjs            # shows what it would send
//   node --env-file=.env.local scripts/pesi-register-callback.mjs --yes      # sends it
//
// Uses PESI_ENV, PESI_CLIENT_ID, PESI_CLIENT_SECRET, PESI_ENCRYPTION_KEY,
// PESI_SOURCE_ACCOUNT (or --account=…), PESI_CALLBACK_SECRET and
// PESI_CALLBACK_BASE_URL / NEXT_PUBLIC_SITE_URL.

import { createCipheriv } from 'node:crypto';

const env = process.env;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const base = (env.PESI_BASE_URL ?? (env.PESI_ENV === 'production' ? 'https://pesipaygw.slafrica.net' : 'https://sit-pesipaygw.slafrica.net')).replace(/\/$/, '');
const site = (env.PESI_CALLBACK_BASE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
const secret = env.PESI_CALLBACK_SECRET ?? '';
const account = args.account ?? env.PESI_SOURCE_ACCOUNT ?? '';
const url = `${site}/api/pesi/callback/${secret}`;

const problems = [];
if (!env.PESI_CLIENT_ID || !env.PESI_CLIENT_SECRET) problems.push('PESI_CLIENT_ID and PESI_CLIENT_SECRET are not set');
if (!/^[0-9a-fA-F]{64}$/.test(env.PESI_ENCRYPTION_KEY ?? '')) problems.push('PESI_ENCRYPTION_KEY must be 64 hex characters');
if (secret.length < 24) problems.push('PESI_CALLBACK_SECRET must be 24+ characters');
if (!site.startsWith('https://') && !env.PESI_BASE_URL) problems.push('the site address must start with https:// (set NEXT_PUBLIC_SITE_URL)');
if (!account) problems.push('no account: set PESI_SOURCE_ACCOUNT or pass --account=…');

console.log(`Gateway:  ${base} (${env.PESI_ENV ?? 'sandbox'})`);
console.log(`Account:  ${account || '(missing)'}`);
console.log(`Callback: ${site}/api/pesi/callback/${secret ? secret.slice(0, 4) + '…' : '(missing)'}`);
if (problems.length) {
  console.error('\nNot ready:\n- ' + problems.join('\n- '));
  process.exit(1);
}
if (!args.yes) {
  console.log('\nPesi allows this only once per account. Check the address above, then run again with --yes.');
  process.exit(0);
}

const cipher = createCipheriv('aes-256-ecb', Buffer.from(env.PESI_ENCRYPTION_KEY, 'hex'), null);
const credentials = Buffer.concat([cipher.update(`${env.PESI_CLIENT_ID}:${env.PESI_CLIENT_SECRET}`, 'utf8'), cipher.final()]).toString('base64');
const auth = await fetch(`${base}/gateway/v1/Onboarding/Authentication/oauth`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ clientId: env.PESI_CLIENT_ID, clientSecret: '', credentials }),
});
const token = (await auth.json().catch(() => ({})))?.response?.accessToken;
if (!token) {
  console.error(`Sign-in failed (${auth.status})`);
  process.exit(1);
}
const r = await fetch(`${base}/gateway/v1/Onboarding/TransactionsManagement/callbacksex/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ callbackUrl: url, sourceAccount: account }),
});
const text = await r.text();
console.log(`\nPesi answered ${r.status}: ${text.slice(0, 500)}`);
process.exit(r.ok ? 0 : 1);

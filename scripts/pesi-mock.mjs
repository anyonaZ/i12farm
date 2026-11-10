#!/usr/bin/env node
// A local stand-in for the Pesi Pay gateway, for development and tests only.
// It follows "PESI PORTAL API DOCUMENTATION (Updated)": same paths, same
// request bodies, the documented callback shape. Where the documentation
// shows no response (STK push, status query, disbursements), the shapes here
// are GUESSES; replace them with real samples once Switchlink onboards us.
//
//   PESI_MOCK_PORT=4010 PESI_MOCK_CLIENT_ID=… PESI_MOCK_CLIENT_SECRET=… PESI_MOCK_KEY=<64 hex> \
//   PESI_MOCK_CALLBACK=http://localhost:3000/api/pesi/callback/<secret> node scripts/pesi-mock.mjs
//
// Point the app at it with PESI_ENV=sandbox and PESI_BASE_URL=http://localhost:4010.
// Phones ending in 9 cancel the M-Pesa prompt; every other phone pays.
// GET /__log lists the requests received (for tests).

import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.PESI_MOCK_PORT ?? 4010);
const CLIENT_ID = process.env.PESI_MOCK_CLIENT_ID ?? 'mock-client';
const CLIENT_SECRET = process.env.PESI_MOCK_CLIENT_SECRET ?? 'mock-secret';
const KEY = process.env.PESI_MOCK_KEY ?? '0'.repeat(64);
const DELAY = Number(process.env.PESI_MOCK_DELAY_MS ?? 1200);
let callbackUrl = process.env.PESI_MOCK_CALLBACK ?? '';

const tokens = new Set();
const txns = new Map(); // partner id → { status, code, description, trace, amount, kind }
const log = [];

function decrypt(b64) {
  const d = createDecipheriv('aes-256-ecb', Buffer.from(KEY, 'hex'), null);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function envelope(extra = {}) {
  return { success: true, remarks: 'Success', errors: null, ...extra };
}

async function callback(id) {
  const t = txns.get(id);
  if (!callbackUrl || !t) return;
  const body = {
    Partner_transaction_id: id,
    Status_code: t.code,
    Status_description: t.description,
    Trace_Id: t.trace,
    Transaction_status: t.status,
  };
  try {
    const r = await fetch(callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    log.push({ at: new Date().toISOString(), out: 'callback', id, status: t.status, answer: r.status });
  } catch (error) {
    log.push({ at: new Date().toISOString(), out: 'callback', id, error: String(error) });
  }
}

function settle(id, ok, description) {
  const t = txns.get(id);
  Object.assign(t, ok
    ? { status: 'COMPLETED', code: 'AC100', description: description ?? 'Transaction Processed Successfully' }
    : { status: 'FAILED', code: 'AC300', description: description ?? 'Request cancelled by user' });
  callback(id);
}

function start(id, amount, kind, ok, failText) {
  if (txns.has(id)) return false;
  txns.set(id, { status: 'PROCESSING', code: '200', description: 'Transaction Processing', trace: randomUUID(), amount, kind });
  setTimeout(() => callback(id), DELAY / 3);
  setTimeout(() => settle(id, ok, ok ? undefined : failText), DELAY);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  log.push({ at: new Date().toISOString(), method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });

  if (url.pathname === '/__log') return send(res, 200, log);
  const p = url.pathname.replace(/^\/gateway\/v1\/Onboarding\//, '');

  if (p === 'Authentication/oauth' && req.method === 'POST') {
    let plain = '';
    try {
      plain = decrypt(body?.credentials ?? '');
    } catch {
      /* wrong key */
    }
    if (body?.clientId !== CLIENT_ID || body?.clientSecret !== '' || plain !== `${CLIENT_ID}:${CLIENT_SECRET}`) {
      return send(res, 401, { response: { accessToken: null, success: false, remarks: 'Invalid credentials', errors: [{ errorCode: 401 }] } });
    }
    const token = randomBytes(24).toString('hex');
    tokens.add(token);
    return send(res, 200, {
      response: { accessToken: token, refreshToken: null, expiresAt: new Date(Date.now() + 3600_000).toISOString().replace('Z', '0000Z'), success: true, remarks: 'Success', errors: null },
    });
  }

  if (!tokens.has((req.headers.authorization ?? '').replace(/^Bearer /, ''))) return send(res, 401, { success: false, remarks: 'Unauthorized' });

  switch (p) {
    case 'AccountManagement/fetchAccountDetails':
      return send(res, 200, envelope({ data: [{ clientID: CLIENT_ID, accountNumber: 'MCA00000080001', accountBalance: '38326.44', billReference: '2222', accountName: 'DefaultAccount' }] }));
    case 'TransactionsManagement/callbacksex/register':
      callbackUrl = body?.callbackUrl ?? callbackUrl;
      return send(res, 200, envelope({ remarks: 'Callback registered' }));
    case 'TransactionsManagement/initiateStkPush': {
      const { phoneNumber, partnerReference, clientAccountReference, amount } = body ?? {};
      if (!/^254[17]\d{8}$/.test(phoneNumber ?? '') || !partnerReference || !clientAccountReference || !(amount > 0)) {
        return send(res, 400, { success: false, remarks: 'Validation failed', errors: [{ errorCode: 400, description: 'Bad request' }] });
      }
      if (!start(partnerReference, amount, 'collection', !phoneNumber.endsWith('9'))) {
        return send(res, 409, { success: false, remarks: 'Duplicate partnerReference', errors: [{ errorCode: 409, description: 'Duplicate' }] });
      }
      return send(res, 200, envelope({ remarks: 'STK push initiated' })); // GUESS: undocumented response
    }
    case 'TransactionsManagement/FetchIPNStatus': {
      const id = url.searchParams.get('PartnerTransactionId');
      const t = txns.get(id);
      if (!t) return send(res, 404, { success: false, remarks: 'Not found', errors: [{ errorCode: 404, description: 'Not found' }] });
      // GUESS: undocumented response; same fields as the callback, inside "data".
      return send(res, 200, envelope({ data: { Partner_transaction_id: id, Status_code: t.code, Status_description: t.description, Trace_Id: t.trace, Transaction_status: t.status } }));
    }
    case 'TransactionsManagement/hakikisha': {
      const type = url.searchParams.get('AccountType');
      const number = url.searchParams.get('AccountNumber') ?? '';
      if (!['BK', 'MB', 'PL', 'TL', 'PP'].includes(type) || !number || (type === 'BK' && !url.searchParams.get('BankCode'))) {
        return send(res, 400, { accountName: '', success: false, remarks: 'Something went wrong, please try again later', errors: [{ errorCode: 400, description: 'Bad request' }] });
      }
      if (number.endsWith('000')) {
        return send(res, 200, { accountName: '', success: false, remarks: 'Something went wrong, please try again later', errors: [{ errorCode: 404, description: 'Unregistered' }] });
      }
      return send(res, 200, { accountName: type === 'MB' ? 'JANE WANJIKU DOE' : 'TEST NAME', success: true, remarks: 'Success', errors: [] });
    }
    case 'TransactionsManagement/Disburse/Single': {
      const b = body ?? {};
      if (!b.partnerTransactionId || !(b.sendAmount > 0) || !['M', 'B', 'B2B'].includes(b.transactionType) || !b.sourceAccount) {
        return send(res, 400, { success: false, remarks: 'Validation failed', errors: [{ errorCode: 400, description: 'Bad request' }] });
      }
      if (!start(b.partnerTransactionId, b.sendAmount, 'disbursement', !String(b.receiverMobile || b.receiverAccount).endsWith('9'), 'Receiver Account Does Not Exist')) {
        return send(res, 409, { success: false, remarks: 'Duplicate partnerTransactionId', errors: [{ errorCode: 409, description: 'Duplicate' }] });
      }
      return send(res, 200, envelope({ remarks: 'Transaction accepted' })); // GUESS
    }
    case 'TransactionsManagement/BulkDisburse/Mobile':
    case 'TransactionsManagement/BulkDisburse/Bank': {
      for (const t of body?.transactions ?? []) start(t.partnerTransactionId, t.sendAmount, 'disbursement', true);
      return send(res, 200, envelope({ remarks: 'Batch accepted' })); // GUESS
    }
    default:
      return send(res, 404, { success: false, remarks: `Unknown path ${url.pathname}` });
  }
});

server.listen(PORT, () => console.log(`Pesi stand-in on http://localhost:${PORT} (callbacks → ${callbackUrl || 'not set'})`));

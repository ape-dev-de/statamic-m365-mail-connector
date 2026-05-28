'use strict';

// Stateless admin-consent redirect broker for the Ape Dev M365 connector.
//
// One URL (e.g. https://m365-mailer-callback.ape-dev.de/callback) is registered
// as the single redirect_uri on the multi-tenant app. The real per-site CP
// callback travels inside an HMAC-signed `state` minted by the addon. This proxy
// verifies the signature and 302-forwards the consent result to that callback.
// No storage, no per-customer config — the shared secret authorizes any install.

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const SECRET = process.env.M365_PROXY_SECRET;

if (!SECRET) {
  console.error('M365_PROXY_SECRET is required');
  process.exit(1);
}

function signature(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Mirrors the addon's buildState(): "<base64url(json)>.<base64url(hmac)>".
function verifyState(state) {
  if (!state || !state.includes('.')) return null;

  const i = state.indexOf('.');
  const body = state.slice(0, i);
  const sig = state.slice(i + 1);

  if (!safeEqual(signature(body), sig)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.origin !== 'string') return null;
  if (Date.now() / 1000 - (payload.ts || 0) > 3600) return null;

  try {
    if (new URL(payload.origin).protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return payload;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }

  if (u.pathname !== '/callback') {
    res.writeHead(404);
    return res.end('not found');
  }

  const payload = verifyState(u.searchParams.get('state'));
  if (!payload) {
    res.writeHead(400);
    return res.end('invalid state');
  }

  const target = new URL(payload.origin);
  for (const key of ['admin_consent', 'tenant', 'error', 'error_description', 'state']) {
    const value = u.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }

  res.writeHead(302, { Location: target.toString() });
  res.end();
});

server.listen(PORT, () => console.log(`m365 consent proxy listening on :${PORT}`));

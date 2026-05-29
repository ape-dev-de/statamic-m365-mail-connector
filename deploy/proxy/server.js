'use strict';

// Ape Dev "M365 mail relay" — stateless. Two jobs, one process:
//
//   JOB 1  GET /callback  — admin-consent forwarding. Microsoft redirects the
//          admin's browser here; we validate the origin against an exact-match
//          allowlist, mint a per-tenant capability token, and 302 it back to the
//          customer CP. The allowlist (not a shared secret) is the open-redirect
//          / token-exfil guard, so NO secret needs to live on customer sites.
//
//   JOB 2  POST /send  — the customer site presents only its capability token.
//          The relay holds the single multi-tenant app's certificate, acquires
//          an app-only Graph token for the token's tenant, and sends the mail.
//          The Graph certificate never leaves this relay; a leaked capability
//          token can at most send mail for its one tenant.
//
// Node built-ins only (http, crypto, fs, global fetch). No external deps.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ---------------------------------------------------------------------------
// Capability tokens — cap = base64url(JSON {tenant,iat,exp}).base64url(HMAC)
// ---------------------------------------------------------------------------

function makeCapabilityToken(tenant, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ tenant, iat: now, exp: now + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyCapabilityToken(cap, secret) {
  if (typeof cap !== 'string' || !cap.includes('.')) return null;
  const i = cap.indexOf('.');
  const body = cap.slice(0, i);
  const sig = cap.slice(i + 1);

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.tenant !== 'string' || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;

  return { tenant: payload.tenant };
}

// ---------------------------------------------------------------------------
// Consent state — base64url(JSON {origin,nonce,ts}), UNSIGNED. The origin is
// only trusted AFTER an exact-match allowlist + https check.
// ---------------------------------------------------------------------------

function parseState(state) {
  if (typeof state !== 'string' || state === '') return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.origin !== 'string') return null;
  return payload;
}

function isHttps(origin) {
  try {
    return new URL(origin).protocol === 'https:';
  } catch {
    return false;
  }
}

function originAllowed(origin, allowedOrigins) {
  return allowedOrigins.has(origin) && isHttps(origin);
}

// ---------------------------------------------------------------------------
// Certificate client assertion (RS256 JWT) for app-only Graph tokens
// ---------------------------------------------------------------------------

// Loads the mounted PEM (private key + public cert), returning the signing key
// and the SHA-1 thumbprint (x5t) Microsoft requires in the assertion header.
function loadCert(pem) {
  const keyMatch = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/);
  const certMatch = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!keyMatch || !certMatch) {
    throw new Error('M365_CERT_PEM must contain both a PRIVATE KEY and a CERTIFICATE block');
  }
  const privateKey = crypto.createPrivateKey(keyMatch[0]);
  const cert = new crypto.X509Certificate(certMatch[0]);
  const x5t = crypto.createHash('sha1').update(cert.raw).digest('base64url');
  return { privateKey, x5t };
}

function buildClientAssertion(tokenEndpoint, clientId, privateKey, x5t) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', x5t };
  const claims = {
    aud: tokenEndpoint,
    iss: clientId,
    sub: clientId,
    jti: crypto.randomUUID(),
    nbf: now,
    exp: now + 300,
    iat: now,
  };
  const signingInput =
    Buffer.from(JSON.stringify(header)).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${sig}`;
}

class GraphError extends Error {
  constructor(status, body) {
    super(`graph error ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Returns getToken(tenant) with a per-tenant cache (until ~5 min before expiry).
function makeGraphTokenGetter(clientId, privateKey, x5t, fetchImpl = fetch) {
  const cache = new Map(); // tenant -> { token, exp }

  return async function getToken(tenant) {
    const now = Math.floor(Date.now() / 1000);
    const hit = cache.get(tenant);
    if (hit && now < hit.exp - 300) return hit.token;

    const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    const assertion = buildClientAssertion(tokenEndpoint, clientId, privateKey, x5t);

    const res = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        scope: GRAPH_SCOPE,
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      }),
    });

    if (!res.ok) throw new GraphError(res.status, await res.text());

    const json = await res.json();
    cache.set(tenant, { token: json.access_token, exp: now + (json.expires_in || 3600) });
    return json.access_token;
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function readJson(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function handleCallback(req, res, url, config) {
  const state = url.searchParams.get('state');
  const parsed = parseState(state);
  if (!parsed) {
    res.writeHead(400);
    return res.end('invalid state');
  }

  // Open-redirect / token-exfil guard: never redirect (let alone carry a cap)
  // to an origin we don't explicitly trust.
  if (!originAllowed(parsed.origin, config.allowedOrigins)) {
    res.writeHead(400);
    return res.end('origin not allowed');
  }

  const target = new URL(parsed.origin);
  const passthrough = (key) => {
    const v = url.searchParams.get(key);
    if (v !== null) target.searchParams.set(key, v);
  };

  const error = url.searchParams.get('error');
  if (error) {
    passthrough('error');
    passthrough('error_description');
    passthrough('state');
    res.writeHead(302, { Location: target.toString() });
    return res.end();
  }

  if (url.searchParams.get('admin_consent') === 'True') {
    const tenant = url.searchParams.get('tenant');
    if (!tenant) {
      res.writeHead(400);
      return res.end('missing tenant');
    }
    const cap = makeCapabilityToken(tenant, config.signingSecret, config.capTtlSec);
    target.searchParams.set('admin_consent', 'True');
    target.searchParams.set('tenant', tenant);
    passthrough('state');
    target.searchParams.set('cap', cap);
    res.writeHead(302, { Location: target.toString() });
    return res.end();
  }

  // Consent not granted — pass the result through so the addon can report it.
  passthrough('admin_consent');
  passthrough('state');
  res.writeHead(302, { Location: target.toString() });
  return res.end();
}

async function handleSend(req, res, config) {
  const auth = req.headers['authorization'] || '';
  const cap = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = verifyCapabilityToken(cap, config.signingSecret);
  if (!claims) {
    res.writeHead(401);
    return res.end('invalid capability');
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    res.writeHead(400);
    return res.end('invalid JSON body');
  }

  const { from, message, saveToSentItems } = body || {};
  // `from` cross-tenant is also fenced naturally: the Graph token below is
  // scoped to the capability's tenant, so sending as a foreign mailbox fails.
  if (typeof from !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from) || !message || typeof message !== 'object') {
    res.writeHead(400);
    return res.end('from (mailbox) and message are required');
  }

  let token;
  try {
    token = await config.getToken(claims.tenant);
  } catch (e) {
    const status = e instanceof GraphError ? e.status : 502;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(e instanceof GraphError ? e.body : JSON.stringify({ error: 'token_acquisition_failed' }));
  }

  let graphRes;
  try {
    graphRes = await config.fetchImpl(`${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: Boolean(saveToSentItems) }),
    });
  } catch {
    res.writeHead(502);
    return res.end('graph request failed');
  }

  if (graphRes.status >= 200 && graphRes.status < 300) {
    res.writeHead(202);
    return res.end();
  }

  const text = await graphRes.text();
  res.writeHead(graphRes.status, { 'Content-Type': graphRes.headers.get('content-type') || 'application/json' });
  return res.end(text);
}

function createServer(config) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200);
      return res.end('ok');
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      return handleCallback(req, res, url, config);
    }
    if (req.method === 'POST' && url.pathname === '/send') {
      return handleSend(req, res, config).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end('internal error');
      });
    }

    res.writeHead(404);
    res.end('not found');
  });
}

module.exports = {
  makeCapabilityToken,
  verifyCapabilityToken,
  parseState,
  originAllowed,
  loadCert,
  buildClientAssertion,
  makeGraphTokenGetter,
  createServer,
  GraphError,
};

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return v;
}

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  const clientId = requireEnv('M365_CLIENT_ID');
  const certPath = requireEnv('M365_CERT_PEM_PATH');
  const signingSecret = requireEnv('RELAY_SIGNING_SECRET');
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) {
    console.error('ALLOWED_ORIGINS is required (comma-separated exact origins)');
    process.exit(1);
  }
  const capTtlSec = (Number(process.env.CAP_TTL_DAYS) || 730) * 24 * 3600;

  const { privateKey, x5t } = loadCert(fs.readFileSync(certPath, 'utf8'));
  const getToken = makeGraphTokenGetter(clientId, privateKey, x5t);

  const config = {
    signingSecret,
    allowedOrigins: new Set(allowed),
    capTtlSec,
    getToken,
    fetchImpl: fetch,
  };

  createServer(config).listen(PORT, () => console.log(`m365 mail relay listening on :${PORT}`));
}

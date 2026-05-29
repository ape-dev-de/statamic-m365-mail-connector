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

// ttlSec falsy (0/null) => non-expiring token. `ver` ties the token to the tenant's
// current revocation version so bumping it kills all of that tenant's older tokens.
function makeCapabilityToken(tenant, secret, ttlSec, ver = 0) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { tenant, iat: now, ver };
  if (ttlSec) payload.exp = now + ttlSec;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Per-tenant lifetime chosen in the CP (state.ttl_days), clamped to operator policy:
// maxTtlDays > 0 caps it AND forces a finite token; resolved 0 days => non-expiring.
function resolveTtlSec(requestedDays, { defaultTtlDays, maxTtlDays }) {
  let days = Number.isInteger(requestedDays) && requestedDays >= 0 ? requestedDays : defaultTtlDays;
  if (maxTtlDays > 0 && (days === 0 || days > maxTtlDays)) days = maxTtlDays;
  return days === 0 ? null : days * 24 * 3600;
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
  if (!payload || typeof payload.tenant !== 'string') return null;
  if (payload.exp !== undefined) {
    if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) >= payload.exp) return null;
  }

  return { tenant: payload.tenant, ver: Number(payload.ver) || 0 };
}

// ---------------------------------------------------------------------------
// Revocation — per-tenant version, file-backed so it survives restarts and can
// be bumped at runtime (POST /admin/revoke). Bumping invalidates that tenant's
// older capability tokens immediately, without touching any other tenant.
// ---------------------------------------------------------------------------

function makeRevocationStore(path) {
  let cache = {};
  let mtime = -1;

  function load() {
    if (!path) return;
    try {
      const st = fs.statSync(path);
      if (st.mtimeMs !== mtime) {
        cache = JSON.parse(fs.readFileSync(path, 'utf8')) || {};
        mtime = st.mtimeMs;
      }
    } catch {
      cache = {};
      mtime = -1;
    }
  }

  return {
    version(tenant) {
      load();
      return Number(cache[tenant]) || 0;
    },
    revoke(tenant) {
      load();
      cache[tenant] = (Number(cache[tenant]) || 0) + 1;
      if (path) fs.writeFileSync(path, JSON.stringify(cache, null, 2));
      return cache[tenant];
    },
  };
}

// Vault-KV-backed revocation store — shared across relay replicas (the file
// store can't be: no RWX storage). Authenticates via Kubernetes auth (the pod's
// ServiceAccount JWT), reads with a short stale-while-revalidate cache so /send
// stays sync + network-free on the hot path, and writes with compare-and-set so
// concurrent revokes of different tenants don't clobber each other.
//
// `version()` is sync (serves the cache, kicks a background refresh when stale);
// `revoke()` is async (CAS read-modify-write against Vault).
function makeVaultRevocationStore({
  addr,
  role,
  kvPath = 'secret/m365-relay/revocations',
  fetchImpl = fetch,
  readSaToken = () => fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8'),
  cacheTtlMs = 15000,
  now = () => Date.now(),
}) {
  const [mount, ...rest] = kvPath.split('/');
  const dataUrl = `${addr}/v1/${mount}/data/${rest.join('/')}`; // KV v2 inserts /data/
  const loginUrl = `${addr}/v1/auth/kubernetes/login`;

  let token = null;
  let tokenExp = 0;
  let cache = {}; // tenant -> version
  let kvVersion = 0; // KV v2 metadata version, for CAS
  let lastFetch = 0;
  let refreshing = null;

  async function vaultToken() {
    if (token && now() < tokenExp) return token;
    const res = await fetchImpl(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, jwt: readSaToken() }),
    });
    if (!res.ok) throw new Error(`vault login ${res.status}`);
    const j = await res.json();
    token = j.auth.client_token;
    tokenExp = now() + Math.max(60, (j.auth.lease_duration || 3600) - 60) * 1000;
    return token;
  }

  async function fetchMap() {
    const res = await fetchImpl(dataUrl, { headers: { 'X-Vault-Token': await vaultToken() } });
    if (res.status === 404) {
      cache = {};
      kvVersion = 0;
      lastFetch = now();
      return;
    }
    if (!res.ok) throw new Error(`vault read ${res.status}`);
    const j = await res.json();
    cache = (j.data && j.data.data) || {};
    kvVersion = (j.data && j.data.metadata && j.data.metadata.version) || 0;
    lastFetch = now();
  }

  function maybeRefresh() {
    if (now() - lastFetch <= cacheTtlMs || refreshing) return;
    refreshing = fetchMap()
      .catch((e) => console.error('revocation refresh failed:', e.message))
      .finally(() => {
        refreshing = null;
      });
  }

  return {
    async init() {
      await fetchMap();
    },
    version(tenant) {
      maybeRefresh(); // stale-while-revalidate, never blocks /send
      return Number(cache[tenant]) || 0;
    },
    async revoke(tenant) {
      for (let attempt = 0; attempt < 4; attempt++) {
        await fetchMap(); // latest map + CAS version
        const next = { ...cache, [tenant]: (Number(cache[tenant]) || 0) + 1 };
        const res = await fetchImpl(dataUrl, {
          method: 'POST',
          headers: { 'X-Vault-Token': await vaultToken(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: next, options: { cas: kvVersion } }),
        });
        if (res.ok) {
          cache = next;
          kvVersion += 1;
          lastFetch = now();
          return next[tenant];
        }
        if (res.status === 400 || res.status === 409) continue; // CAS conflict — retry
        throw new Error(`vault write ${res.status}`);
      }
      throw new Error('vault revoke: CAS retries exhausted');
    },
  };
}

// Per-tenant sliding-window rate limit (in-memory). Transient misuse guard: a
// burst (e.g. a leaked token blasting mail) gets 429'd without a permanent lockout.
function makeRateLimiter(max, windowSec) {
  const hits = new Map();
  return function allow(tenant) {
    if (!max) return true;
    const now = Date.now();
    const cutoff = now - windowSec * 1000;
    const arr = (hits.get(tenant) || []).filter((t) => t > cutoff);
    arr.push(now);
    hits.set(tenant, arr);
    return arr.length <= max;
  };
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
    const ttlSec = resolveTtlSec(Number(parsed.ttl_days), config);
    const ver = config.revocations ? config.revocations.version(tenant) : 0;
    const cap = makeCapabilityToken(tenant, config.signingSecret, ttlSec, ver);
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

  if (config.revocations && claims.ver < config.revocations.version(claims.tenant)) {
    res.writeHead(401);
    return res.end('capability revoked');
  }

  if (config.rateLimiter && !config.rateLimiter(claims.tenant)) {
    res.writeHead(429);
    return res.end('rate limit exceeded');
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

// POST /admin/revoke {tenant} with header X-Admin-Secret — bumps the tenant's
// revocation version, instantly killing its existing capability tokens.
async function handleRevoke(req, res, config) {
  if (!config.adminSecret || !config.revocations) {
    res.writeHead(404);
    return res.end('not found');
  }

  const provided = Buffer.from(req.headers['x-admin-secret'] || '');
  const expected = Buffer.from(config.adminSecret);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    res.writeHead(401);
    return res.end('unauthorized');
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    res.writeHead(400);
    return res.end('invalid JSON body');
  }

  const tenant = body && body.tenant;
  if (typeof tenant !== 'string' || tenant === '') {
    res.writeHead(400);
    return res.end('tenant required');
  }

  const version = await config.revocations.revoke(tenant);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ tenant, version }));
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
    if (req.method === 'POST' && url.pathname === '/admin/revoke') {
      return handleRevoke(req, res, config).catch(() => {
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
  resolveTtlSec,
  verifyCapabilityToken,
  makeRevocationStore,
  makeVaultRevocationStore,
  makeRateLimiter,
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

async function main() {
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
  const defaultTtlDays = Number(process.env.CAP_TTL_DAYS) || 730;  // used when the CP sends no ttl_days
  const maxTtlDays = Number(process.env.CAP_MAX_TTL_DAYS) || 0;    // 0 = no ceiling (unlimited allowed)

  const { privateKey, x5t } = loadCert(fs.readFileSync(certPath, 'utf8'));
  const getToken = makeGraphTokenGetter(clientId, privateKey, x5t);

  // Revocation store: Vault KV (shared across replicas) when VAULT_ADDR is set,
  // else a local file (single-replica fallback). Kill switch: POST /admin/revoke.
  let revocations;
  if (process.env.VAULT_ADDR) {
    revocations = makeVaultRevocationStore({
      addr: process.env.VAULT_ADDR,
      role: requireEnv('VAULT_ROLE'),
      kvPath: process.env.REVOCATIONS_VAULT_PATH || 'secret/m365-relay/revocations',
    });
    try {
      await revocations.init();
    } catch (e) {
      console.error('initial revocation load from Vault failed (continuing, will retry):', e.message);
    }
  } else {
    revocations = makeRevocationStore(process.env.REVOCATIONS_PATH || '');
  }

  const config = {
    signingSecret,
    allowedOrigins: new Set(allowed),
    defaultTtlDays,
    maxTtlDays,
    getToken,
    fetchImpl: fetch,
    revocations,
    adminSecret: process.env.RELAY_ADMIN_SECRET || '',
    // Transient misuse guard: max sends per tenant per window.
    rateLimiter: makeRateLimiter(Number(process.env.SEND_RATE_MAX) || 60, Number(process.env.SEND_RATE_WINDOW_SEC) || 60),
  };

  createServer(config).listen(PORT, () => console.log(`m365 mail relay listening on :${PORT}`));
}

if (require.main === module) {
  main().catch((e) => {
    console.error('fatal:', e);
    process.exit(1);
  });
}

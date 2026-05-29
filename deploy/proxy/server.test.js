'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

const {
  makeCapabilityToken,
  verifyCapabilityToken,
  parseState,
  originAllowed,
  loadCert,
  buildClientAssertion,
  createServer,
} = require('./server');

const SECRET = 'test-relay-signing-secret-0123456789';
const ORIGIN = 'https://festglanz.de/cp/m365-mailer/callback';
const TENANT = '11111111-2222-3333-4444-555555555555';

// Throwaway self-signed cert (key + cert) — TEST FIXTURE ONLY, not a secret.
const TEST_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDHeDh0IAKG5ZV1
uyKPQ/V9O2oZaGNWBFRdnOfEJBExAFe5n1UfuONbd1wqSCRY4pkpuLEp338DHmRF
2it2TdQGm/ozrtp5MqygwCqtQ9AAMfsUzzZxbfwIxP+ZBjfXkyr8HrtdIjA6xawx
Vixopd4M3YtGBe811yYuJiU2pH4276+4RVA0XSwc1oNYzyFm5oJWEUmttTGZj/YJ
S1HzH96ITPXgUnnl/OYdq1Ad+9srkScQcST0qM5kIyVoh9PrM3dIB9V8KHuT+ErF
KKpjTvZxp2EhfiSywNIG1JwPdjBVCQllmrWfQlvAdnZJ7NhN2xFOPX6ipV6Cun/A
8jlGoIb7AgMBAAECgf9X/DVFrn3sAu0EBEZCzyYy7J67XXsHrDxAkZH5oDNsjuTN
4n0kNDO6d1UtUWDZKZf50iXWZngraADB9u7fksSbew+x76qiCeLiwSsXrnP9i0z5
n3L7I/d87HmkrgWTFHa8gKRMt6ifmWSFqKI4D2PUy82xfrluriujiqGyFRtpz6+Z
/0PqxSFYHZF9MO9dkFcCS9b/clKwUx4RdE1tjH4vaUHmCyITRt8qR4ggM/zBZqcd
kxcq8JfoxxlzKOS8IJZlN37/O2WxuGVEe5sIKh0QUSC5fSYTgj7YDJ/YpBDvqim3
I7/sBDj/TVFxXWXCsKN+oXXqgz/RcAMMZqfT0J0CgYEA+Xay1fBr3IhXy2+narAO
mEiRObuLLq+JEggvlPgUe0DtfvgPbsevHK0SBEzGCik+KCtGCpIQYOI6V0GXI67f
IDbFFgHpoTy1RWwv/riCG4lwcu75mrdz34xUMcssIQhDf4sZ8NLkGhCUY5ufFn51
reYLv6IhlGQmf7DlKJxsWg0CgYEAzLIumeVz3G6h4S+Z3jVysOjEitvGvjfUZZ67
bho9HWbgKU0+g1R9KYsB3UypAMlfS2iLcFyIF6bAW0a4mBdayc3ekFeSUYcuxDxB
BnEO7LpAHldOiwSdwYq8QuffWr5oHOdxyN2F9GzSxfP3RBUsgzSmk0SWNLoNRQNA
MMRxSycCgYEAoKyeJQOURVefzI0etK2uyNC8kQXFcI1o6K9TDkz2zCgWj9fwALcm
h37FgvV7/KFxwmeU1kwbtnsffoHlefsxBUuhhzo2Iz65tnwnMZXfXyMXxT88jzUn
sc1tkSC+TIxJBUYvsBf1CQCywrFCNze+TgJEgOpJXI1g6o+iGZUeiKUCgYAbEsYP
HMYCNa+7dOxI85DDzUWRiBf1OLUi66emnFnQ9bZYQBswi5AyWmxYtLb1n6y28JDg
v5xQZIG0kNoBY7ViU5RISwzTM6n/0mhXTcTHkqrAWJPO10F2Q786qihkfCKREBuA
kawR9AK8o9PkcVh90gzmFYA4YRM4OYHX8WN6qQKBgQCNNaIg5Tl0L2vm0yTxVXTG
mtP03kb7+5sZkuf4J6WeeTxVlaW7K4cre2tljF2p7lH5Rgwe42DwGeYMCveOaMlL
2Lbp1p4dHYVxpwwDztG+UYc0ci8IIKk+hbMQuDLdTz32A7mogMrCVddr6Q2DMfLU
ZkUEczwSB6DXvHnu2iEX1w==
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIIDCzCCAfOgAwIBAgIUFbXIUq2S5OljuW16jyzxaGzwWrAwDQYJKoZIhvcNAQEL
BQAwFTETMBEGA1UEAwwKcmVsYXktdGVzdDAeFw0yNjA1MjkwOTM1NDlaFw0zNjA1
MjYwOTM1NDlaMBUxEzARBgNVBAMMCnJlbGF5LXRlc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDHeDh0IAKG5ZV1uyKPQ/V9O2oZaGNWBFRdnOfEJBEx
AFe5n1UfuONbd1wqSCRY4pkpuLEp338DHmRF2it2TdQGm/ozrtp5MqygwCqtQ9AA
MfsUzzZxbfwIxP+ZBjfXkyr8HrtdIjA6xawxVixopd4M3YtGBe811yYuJiU2pH42
76+4RVA0XSwc1oNYzyFm5oJWEUmttTGZj/YJS1HzH96ITPXgUnnl/OYdq1Ad+9sr
kScQcST0qM5kIyVoh9PrM3dIB9V8KHuT+ErFKKpjTvZxp2EhfiSywNIG1JwPdjBV
CQllmrWfQlvAdnZJ7NhN2xFOPX6ipV6Cun/A8jlGoIb7AgMBAAGjUzBRMB0GA1Ud
DgQWBBSECTpvUqw0oHqD4x0yiHs3Ebru6jAfBgNVHSMEGDAWgBSECTpvUqw0oHqD
4x0yiHs3Ebru6jAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAK
tbG7QryvutwmDMCJ+MQTqFC2DhbooiyyU/7Pvc3PEsvsOrunS+42Y2xzh/BQ5dgk
zRUmqNhjbgCqLsggEWMBrRbIvD8CE3mE1roOLFt/V+MAJLN16HeTAs69t4hz0gDa
mjWKRPwiHIz17VKI1TAcE6TJPoQnazjiusleSeqqimwIj1f/p5rlZv8RMgrzAug8
aipGQtENPoX76K8pLX/FtRnqFSRpB5UJPsafIemJVTg0h9aZOWIY9R5EgaisxZJL
v7s4yhhj3vwq0AXlUMj76logbl8amnK0iAugWBKRpvM0aXmuns3LcY/GdIBEXtm4
IJT9Yq4E1Ro8i0ROEbIO
-----END CERTIFICATE-----`;

// ---- capability tokens ----

test('capability token round-trips and yields its tenant', () => {
  const cap = makeCapabilityToken(TENANT, SECRET, 3600);
  assert.deepEqual(verifyCapabilityToken(cap, SECRET), { tenant: TENANT });
});

test('a leaked cap is limited to ONE tenant (no cross-tenant)', () => {
  const cap = makeCapabilityToken(TENANT, SECRET, 3600);
  const other = '99999999-0000-0000-0000-000000000000';
  assert.notEqual(verifyCapabilityToken(cap, SECRET).tenant, other);
});

test('expired cap is rejected', () => {
  const cap = makeCapabilityToken(TENANT, SECRET, -1);
  assert.equal(verifyCapabilityToken(cap, SECRET), null);
});

test('tampered cap / wrong secret is rejected', () => {
  const cap = makeCapabilityToken(TENANT, SECRET, 3600);
  assert.equal(verifyCapabilityToken(cap, 'other-secret'), null);
  assert.equal(verifyCapabilityToken(cap.slice(0, -2) + 'xx', SECRET), null);
  assert.equal(verifyCapabilityToken('garbage', SECRET), null);
});

// ---- state + origin allowlist ----

function stateFor(origin) {
  return Buffer.from(JSON.stringify({ origin, nonce: 'n', ts: Math.floor(Date.now() / 1000) })).toString('base64url');
}

test('parseState decodes origin; garbage -> null', () => {
  assert.equal(parseState(stateFor(ORIGIN)).origin, ORIGIN);
  assert.equal(parseState('not-base64url-json'), null);
  assert.equal(parseState(''), null);
});

test('originAllowed: exact-match https only', () => {
  const allow = new Set([ORIGIN]);
  assert.equal(originAllowed(ORIGIN, allow), true);
  assert.equal(originAllowed('https://evil.com/cb', allow), false); // not listed
  assert.equal(originAllowed('http://festglanz.de/cp/m365-mailer/callback', allow), false); // not listed + not https
});

// ---- certificate client assertion ----

test('buildClientAssertion: RS256 + x5t header, verifiable signature', () => {
  const { privateKey, x5t } = loadCert(TEST_PEM);
  assert.match(x5t, /^[A-Za-z0-9_-]+$/);

  const endpoint = 'https://login.microsoftonline.com/' + TENANT + '/oauth2/v2.0/token';
  const jwt = buildClientAssertion(endpoint, 'client-abc', privateKey, x5t);
  const [h, c, s] = jwt.split('.');

  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(header.alg, 'RS256');
  assert.equal(header.typ, 'JWT');
  assert.equal(header.x5t, x5t);
  assert.equal(claims.aud, endpoint);
  assert.equal(claims.iss, 'client-abc');
  assert.equal(claims.sub, 'client-abc');
  assert.equal(claims.exp - claims.iat, 300);
  assert.ok(claims.jti);

  const pub = new crypto.X509Certificate(TEST_PEM).publicKey;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), pub, Buffer.from(s, 'base64url'));
  assert.equal(ok, true);
});

// ---- HTTP integration (stubbed Graph) ----

function startServer(overrides = {}) {
  const fetchCalls = [];
  const config = {
    signingSecret: SECRET,
    allowedOrigins: new Set([ORIGIN]),
    capTtlSec: 3600,
    getToken: async () => 'fake-graph-token',
    fetchImpl: async (url, opts) => {
      fetchCalls.push({ url, opts });
      return {
        status: 202,
        headers: { get: () => null },
        text: async () => '',
      };
    },
    ...overrides,
  };
  const server = createServer(config);
  return new Promise((resolve) => {
    server.listen(0, () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, server, fetchCalls });
    });
  });
}

test('GET /health -> ok', async () => {
  const { base, server } = await startServer();
  try {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'ok');
  } finally {
    server.close();
  }
});

test('consent: allow-listed origin -> 302 with a valid cap', async () => {
  const { base, server } = await startServer();
  try {
    const url = `${base}/callback?admin_consent=True&tenant=${TENANT}&state=${stateFor(ORIGIN)}`;
    const r = await fetch(url, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get('location'));
    assert.equal(`${loc.origin}${loc.pathname}`, ORIGIN);
    assert.equal(loc.searchParams.get('admin_consent'), 'True');
    assert.equal(loc.searchParams.get('tenant'), TENANT);
    const cap = loc.searchParams.get('cap');
    assert.ok(cap, 'cap present');
    assert.deepEqual(verifyCapabilityToken(cap, SECRET), { tenant: TENANT });
  } finally {
    server.close();
  }
});

test('consent: non-allow-listed origin -> 400, no redirect', async () => {
  const { base, server } = await startServer();
  try {
    const evil = 'https://evil.example/cb';
    const r = await fetch(`${base}/callback?admin_consent=True&tenant=${TENANT}&state=${stateFor(evil)}`, {
      redirect: 'manual',
    });
    assert.equal(r.status, 400);
    assert.equal(r.headers.get('location'), null);
  } finally {
    server.close();
  }
});

test('consent error is forwarded without a cap', async () => {
  const { base, server } = await startServer();
  try {
    const url = `${base}/callback?error=access_denied&error_description=nope&state=${stateFor(ORIGIN)}`;
    const r = await fetch(url, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get('location'));
    assert.equal(loc.searchParams.get('error'), 'access_denied');
    assert.equal(loc.searchParams.get('cap'), null);
  } finally {
    server.close();
  }
});

test('send: valid cap -> 202 and Graph called for the from mailbox', async () => {
  const { base, server, fetchCalls } = await startServer();
  try {
    const cap = makeCapabilityToken(TENANT, SECRET, 3600);
    const r = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cap}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'kontakt@festglanz.de', message: { subject: 'hi' }, saveToSentItems: true }),
    });
    assert.equal(r.status, 202);
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/users/kontakt%40festglanz.de/sendMail'));
    assert.equal(fetchCalls[0].opts.headers.Authorization, 'Bearer fake-graph-token');
    assert.match(fetchCalls[0].opts.body, /"subject":"hi"/);
  } finally {
    server.close();
  }
});

test('send: invalid cap -> 401, Graph not called', async () => {
  const { base, server, fetchCalls } = await startServer();
  try {
    const r = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-valid-cap', 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'kontakt@festglanz.de', message: {} }),
    });
    assert.equal(r.status, 401);
    assert.equal(fetchCalls.length, 0);
  } finally {
    server.close();
  }
});

test('send: Graph failure propagates status + body', async () => {
  const { base, server } = await startServer({
    fetchImpl: async () => ({
      status: 403,
      headers: { get: () => 'application/json' },
      text: async () => '{"error":"forbidden"}',
    }),
  });
  try {
    const cap = makeCapabilityToken(TENANT, SECRET, 3600);
    const r = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cap}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'kontakt@festglanz.de', message: {} }),
    });
    assert.equal(r.status, 403);
    assert.match(await r.text(), /forbidden/);
  } finally {
    server.close();
  }
});

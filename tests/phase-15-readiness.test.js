/**
 * Phase 15: production readiness fixes. CSRF exemptions for signed/credential-less endpoints, chat
 * attachments (private storage, access before storage, authorized reads), rate limits on chat and
 * uploads, CSP report-only and report endpoint, robots/sitemap/noindex, the configuration report,
 * backup/restore safety (format, checksums, target refusals), and the evidence-based index plan.
 * Real-MongoDB backup and restore is covered by scripts/restore-drill.js (CI runs it).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ObjectId, Decimal128 } = require('mongodb');
const { paymentMemoryDb } = require('./helpers/payment-memory-db');
const { loadModule, mockResponse } = require('./helpers/ts-loader');
const { requestHeaders, seedSession } = require('./helpers/session-cookie');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ENV = { NODE_ENV: 'test', MONGODB_DB_NAME: 'forexorbit_p15_test', MONGO_URI: 'mongodb://127.0.0.1:27017', APP_ORIGIN: undefined, SHARED_RATE_LIMIT: undefined };
async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('CSRF guard: the signed Resend webhook and CSP reports are exempt; everything else stays guarded', () => {
  const { decideRequestOrigin } = require('../lib/request-guard');
  const env = { APP_ORIGIN: 'https://app.example.com', NODE_ENV: 'production' };
  const none = () => undefined;
  for (const pathname of ['/api/paystack/webhook', '/api/webhooks/resend', '/api/csp-report']) assert.equal(decideRequestOrigin({ method: 'POST', pathname, header: none, env }).ok, true, pathname);
  for (const pathname of ['/api/notifications', '/api/webhooks/other', '/api/communication/preferences', '/api/csp-report-x']) assert.equal(decideRequestOrigin({ method: 'POST', pathname, header: none, env }).ok, false, pathname);
  // The webhook still verifies its own signature (it refuses without the secret).
  assert.match(read('pages/api/webhooks/resend.ts'), /verify\(body, req\.headers/);
});

test('chat attachments: private storage, access checked before storing, no public/ writes, rate limited', () => {
  for (const file of ['pages/api/consultations/messages/upload.ts', 'pages/api/community/messages/upload.ts']) {
    const src = read(file);
    assert.equal(/process\.cwd\(\), 'public'|\/uploads\/(consultations|community)\//.test(src), false, `${file} still writes under public/`);
    assert.match(src, /uploadDir: os\.tmpdir\(\)/);
    assert.match(src, /allowRequest\(uploadLimiter/);
    assert.match(src, /maxFileSize: ATTACHMENT_MAX_BYTES/);
    assert.match(src, /fs\.promises\.unlink\(tempPath\)/);
    // The storage call comes after the access decision.
    const access = Math.max(src.indexOf("return res.status(403).json({ error: 'Access denied' });"), src.indexOf('if (!access.ok) {'));
    assert.ok(access > 0 && src.indexOf('storeChatAttachment(') > access, `${file}: storage must follow the access check`);
  }
  assert.match(read('lib/chat-attachments.ts'), /type: 'private'/);
  for (const file of ['pages/api/community/messages.ts', 'pages/api/consultations/messages.ts', 'pages/api/messages/index.ts']) assert.match(read(file), /allowRequest\(chatLimiter/, file);
  for (const file of ['pages/api/upload/profile.ts', 'pages/api/certificates/upload.ts']) assert.match(read(file), /allowRequest\(uploadLimiter/, file);
  const limits = require('../lib/content-rate-limit');
  assert.equal(limits.CHAT_RULES[0].max, 120);
});

test('attachment reads: participants and room members only; signed, uncached redirect; others 404', () => withEnv(ENV, async () => {
  const db = paymentMemoryDb({});
  const ids = { student: new ObjectId().toHexString(), expert: new ObjectId().toHexString(), outsider: new ObjectId().toHexString() };
  for (const [k, id] of Object.entries(ids)) db.rows('users').push({ _id: new ObjectId(id), role: k === 'expert' ? 'instructor' : 'student', status: 'approved', sessionGeneration: 0, learningLevel: 'beginner', name: k });
  const sessionId = new ObjectId();
  db.rows('consultationSessions').push({ _id: sessionId, studentId: ids.student, expertId: ids.expert, status: 'active' });
  const msgId = new ObjectId();
  db.rows('consultationMessages').push({ _id: msgId, sessionId: String(sessionId), attachment: { publicId: 'forexorbit/consultation-chat/abc', resourceType: 'raw', format: 'pdf', delivery: 'private' } });
  const legacy = new ObjectId();
  db.rows('consultationMessages').push({ _id: legacy, sessionId: String(sessionId), fileUrl: '/uploads/consultations/x.pdf' });
  const signed = [];
  const handler = loadModule('pages/api/attachments/[kind]/[id].ts', {
    'lib/mongodb': { getDb: async () => db },
    'lib/socket-server': { getSocketServer: () => null },
    'lib/chat-attachments': { signedAttachmentUrl: (a) => { signed.push(a.publicId); return `https://signed.example/${a.publicId}?exp`; } },
  }).default;
  const T = {};
  for (const [k, id] of Object.entries(ids)) T[k] = seedSession(db.rows('sessions'), { userId: id, generation: 0, now: new Date() });
  const open = async (token, kind, id) => {
    const res = mockResponse();
    res.redirect = function redirect(code, url) { this.statusCode = code; this.location = url; return this; };
    await handler({ method: 'GET', url: '/x', headers: requestHeaders(token), query: { kind, id }, socket: { remoteAddress: '10.1.1.1' } }, res);
    return res;
  };
  const ok = await open(T.student, 'consultation', String(msgId));
  assert.equal(ok.statusCode, 302);
  assert.equal(ok.location, 'https://signed.example/forexorbit/consultation-chat/abc?exp');
  assert.match(ok.headers['cache-control'], /no-store/);
  assert.equal((await open(T.expert, 'consultation', String(msgId))).statusCode, 302);
  assert.equal((await open(T.outsider, 'consultation', String(msgId))).statusCode, 404);
  assert.equal((await open(T.student, 'consultation', String(legacy))).statusCode, 404);
  assert.equal((await open(T.student, 'nope', String(msgId))).statusCode, 404);
  assert.equal((await open(T.student, 'consultation', '../etc')).statusCode, 404);
  assert.equal((await open(undefined, 'consultation', String(msgId))).statusCode >= 401, true);
  assert.equal(signed.length, 2);
}));

test('headers: no X-Powered-By; full CSP in report-only; private areas noindex; robots and sitemap rewrites', async () => {
  const config = require('../next.config.js');
  assert.equal(config.poweredByHeader, false);
  const rules = await config.headers();
  const all = rules.find((r) => r.source === '/:path*').headers;
  const enforced = all.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(enforced, /frame-ancestors 'none'/);
  const report = all.find((h) => h.key === 'Content-Security-Policy-Report-Only').value;
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", 'report-uri /api/csp-report', 'https://js.paystack.co', 'wss://*.agora.io']) assert.ok(report.includes(d), d);
  for (const source of ['/admin/:path*', '/api/:path*', '/dashboard', '/settings/:path*', '/instructor/:path*']) {
    assert.ok(rules.some((r) => r.source === source && r.headers.some((h) => h.key === 'X-Robots-Tag' && /noindex/.test(h.value))), source);
  }
  assert.equal(rules.some((r) => r.source === '/courses/:path*' && r.headers.some((h) => h.key === 'X-Robots-Tag')), false);
  assert.deepEqual((await config.rewrites()).map((r) => r.source), ['/robots.txt', '/sitemap.xml']);
});

test('CSP report endpoint: logs only directive, blocked host and page path; capped; always 204', async () => {
  const handler = loadModule('pages/api/csp-report.ts', {}).default;
  const logs = [];
  const warn = console.warn;
  console.warn = (line) => logs.push(line);
  try {
    const send = async (body) => {
      const res = mockResponse();
      res.end = function end() { return this; };
      await handler({ method: 'POST', headers: {}, socket: { remoteAddress: '10.9.9.9' }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } }, res);
      return res;
    };
    const r = await send(JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js?token=secret', 'document-uri': 'https://app.example.com/dashboard?session=abc' } }));
    assert.equal(r.statusCode, 204);
    const entry = JSON.parse(logs[0]);
    assert.deepEqual(entry, { event: 'cspViolation', directive: 'script-src', blocked: 'evil.example', page: '/dashboard' });
    assert.equal(logs[0].includes('secret') || logs[0].includes('session=abc'), false);
    assert.equal((await send('x'.repeat(9000))).statusCode, 204);
    assert.equal((await send('not json')).statusCode, 204);
  } finally {
    console.warn = warn;
  }
});

test('robots and sitemap: private areas disallowed and never listed; values escaped; course ids validated', () => {
  const seo = require('../lib/seo');
  const robots = seo.robotsTxt('https://app.example.com');
  for (const p of ['/api', '/admin', '/instructor', '/dashboard', '/settings']) assert.match(robots, new RegExp(`Disallow: ${p}\\n`));
  assert.match(robots, /Sitemap: https:\/\/app\.example\.com\/sitemap\.xml/);
  const xml = seo.sitemapXml('https://app.example.com', [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, { id: '../admin' }]);
  assert.match(xml, /<loc>https:\/\/app\.example\.com\/courses\/aaaaaaaaaaaaaaaaaaaaaaaa<\/loc>/);
  assert.equal(xml.includes('../admin'), false);
  for (const p of seo.PRIVATE_PREFIXES) assert.equal(xml.includes(`${p}<`) || xml.includes(`${p}/`), false, p);
});

test('configuration report: names and impact only, never values', () => {
  const { configReport, configReportLine } = require('../lib/config-report');
  const env = { PAYSTACK_SECRET_KEY: 'sk_live_supersecretvalue', RESEND_API_KEY: 're_secretkey', RESEND_FROM: 'a@b.c', APP_BASE_URL: 'https://x.example', NEXT_PUBLIC_AGORA_APP_ID: 'id', AGORA_APP_CERTIFICATE: 'cert' };
  const rows = configReport(env);
  assert.equal(rows.find((r) => r.id === 'payments').configured, true);
  assert.equal(rows.find((r) => r.id === 'video').configured, true);
  assert.deepEqual(rows.find((r) => r.id === 'storage').missing, ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);
  const line = configReportLine(env);
  for (const secret of ['sk_live_supersecretvalue', 're_secretkey', 'cert']) assert.equal(line.includes(secret), false);
  assert.match(read('server.js'), /configReportLine\(process\.env\)/);
});

test('backups: typed format round-trips; checksums verified; restore refuses production and unsafe targets', async () => {
  const B = require('../lib/db-backup');
  const { EJSON } = require('mongodb').BSON;
  // The retired format lost types: plain JSON turns a Decimal128 into an object and an ObjectId into a string.
  const doc = { _id: new ObjectId(), amount: Decimal128.fromString('-12.34'), at: new Date('2026-11-20T00:00:00Z') };
  const plain = JSON.parse(JSON.stringify(doc));
  assert.equal(typeof plain._id, 'string');
  assert.equal(plain.amount instanceof Decimal128, false);
  const back = EJSON.parse(EJSON.stringify(doc, { relaxed: false }), { relaxed: false });
  assert.ok(back._id instanceof ObjectId && back.amount instanceof Decimal128 && back.at instanceof Date);
  assert.equal(back.amount.toString(), '-12.34');
  // Restore refuses before touching the database.
  const client = { db: () => { throw new Error('must not be reached'); } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-p15-'));
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ format: B.FORMAT, collections: [{ name: 'users', count: 1, sha256: '0'.repeat(64), indexes: [], options: {} }] }));
    fs.writeFileSync(path.join(dir, 'users.ndjson'), '{"_id":{"$oid":"000000000000000000000001"}}\n');
    await assert.rejects(() => B.restoreDatabase(client, dir, 'Forex_elearning'), /production database name/);
    await assert.rejects(() => B.restoreDatabase(client, dir, 'Forex_elearning_copy'), /must end in/);
    await assert.rejects(() => B.restoreDatabase(client, dir, 'Forex_elearning_restore'), /checksum mismatch/);
    assert.equal((await B.verifyBackup(dir)).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const f of ['scripts/backup-data.js', 'scripts/restore-data.js']) assert.match(read(f), /retired/);
  assert.match(read('scripts/restore-drill.js'), /Refusing: the drill runs only against localhost/);
});

test('index plan: every Phase 15 index is named and tied to a measured query', () => {
  const { COMMUNICATION_INDEXES } = require('../lib/communication-indexes');
  assert.deepEqual(COMMUNICATION_INDEXES.map((i) => i.id), ['C1', 'C2', 'C3', 'C4']);
  for (const i of COMMUNICATION_INDEXES) {
    assert.ok(i.options.name && i.serves, i.id);
  }
  // The queries they serve still have these shapes.
  assert.match(read('lib/communication/delivery.js'), /'channels\.email\.state': \{ \$in: \['queued', 'retrying'\] \}, 'channels\.email\.nextAttemptAt'/);
  assert.match(read('lib/communication/delivery.js'), /findOne\(\{ 'channels\.email\.providerId': providerId \}/);
});

test('CI workflow: type-check, lint, tests, audit, build and the real-MongoDB suites; no deploy, no secrets', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const step of ['npx tsc --noEmit', 'npm run lint', 'npm test', 'npm audit --omit=dev --audit-level=high', 'npm run build', 'npm run test:mongo:trading', 'npm run test:mongo:hardkill', 'node scripts/restore-drill.js']) assert.ok(ci.includes(step), step);
  assert.equal(/secrets\.|deploy-hook|api\.render\.com|RENDER_/i.test(ci), false);
  assert.match(ci, /permissions:\n  contents: read/);
});

test('database client: bounded timeouts and pool; a failed connection is retried on the next request', async () => {
  const { clientOptions, connectShared } = require('../lib/mongo-options');
  const o = clientOptions({});
  assert.equal(o.serverSelectionTimeoutMS, 10000);
  assert.equal(o.maxPoolSize, 50);
  assert.equal(clientOptions({ MONGO_MAX_POOL_SIZE: '120' }).maxPoolSize, 120);
  assert.equal(clientOptions({ MONGO_MAX_POOL_SIZE: '9999' }).maxPoolSize, 50);
  let attempts = 0;
  class FakeClient {
    constructor(uri, options) { this.options = options; }
    connect() { attempts += 1; return attempts === 1 ? Promise.reject(new Error('down')) : Promise.resolve(this); }
  }
  const holder = {};
  const error = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => connectShared(FakeClient, 'mongodb://x', holder));
    await new Promise((r) => setImmediate(r));
    assert.equal(holder._mongoClientPromise, undefined);
    const client = await connectShared(FakeClient, 'mongodb://x', holder);
    assert.equal(client.options.serverSelectionTimeoutMS, 10000);
    assert.equal(await connectShared(FakeClient, 'mongodb://x', holder), client);
    assert.equal(attempts, 2);
  } finally {
    console.error = error;
  }
});

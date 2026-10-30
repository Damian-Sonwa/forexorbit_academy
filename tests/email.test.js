/**
 * lib/email.ts and lib/email-templates.ts with the Resend SDK replaced by a recording fake.
 * No network, no real key, no real domain.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/ts-loader');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
const PROD = {
  NODE_ENV: 'production',
  APP_BASE_URL: 'https://app.example.test',
  RESEND_API_KEY: 're_test_only_not_a_real_key',
  RESEND_FROM: 'ForexOrbit Academy <no-reply@mail.example.test>',
};

function fakeResend(outcome = async () => ({ data: { id: 'email_1' }, error: null })) {
  const calls = { keys: [], sends: [] };
  class Resend {
    constructor(key) {
      calls.keys.push(key);
      this.emails = { send: (payload, options) => { calls.sends.push({ payload, options }); return outcome(payload); } };
    }
  }
  return { calls, email: loadModule('lib/email.ts', { resend: { Resend } }) };
}

function captureConsole(fn) {
  const lines = [];
  const saved = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ value, lines }))
    .finally(() => Object.assign(console, saved));
}

const resetInput = (extra = {}) => ({
  to: 'person@example.com',
  name: 'Ada',
  token: TOKEN,
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  idempotencyKey: 'password-reset/abc',
  ...extra,
});

test('production needs a key, a non-test sender and an https origin; development has safe defaults', () => {
  const { email } = fakeResend();
  const read = (env) => email.readEmailConfig(env);
  assert.deepEqual(read(PROD), { ok: true, apiKey: PROD.RESEND_API_KEY, from: PROD.RESEND_FROM, appBaseUrl: 'https://app.example.test' });
  assert.equal(read({ ...PROD, APP_BASE_URL: 'https://app.example.test/' }).appBaseUrl, 'https://app.example.test');

  const problems = [
    [{ RESEND_API_KEY: '' }, 'missing_api_key'],
    [{ RESEND_API_KEY: '   ' }, 'missing_api_key'],
    [{ RESEND_FROM: '' }, 'missing_sender'],
    [{ RESEND_FROM: 'onboarding@resend.dev' }, 'test_sender_in_production'],
    [{ RESEND_FROM: 'ForexOrbit <Onboarding@Resend.dev>' }, 'test_sender_in_production'],
    [{ APP_BASE_URL: '' }, 'missing_app_base_url'],
    [{ APP_BASE_URL: 'http://app.example.test' }, 'invalid_app_base_url'],
    [{ APP_BASE_URL: 'https://app.example.test/reset' }, 'invalid_app_base_url'],
    [{ APP_BASE_URL: 'https://app.example.test?x=1' }, 'invalid_app_base_url'],
    [{ APP_BASE_URL: 'https://user:pw@app.example.test' }, 'invalid_app_base_url'],
    [{ APP_BASE_URL: 'javascript:alert(1)' }, 'invalid_app_base_url'],
    [{ APP_BASE_URL: 'not a url' }, 'invalid_app_base_url'],
  ];
  for (const [change, reason] of problems) {
    assert.deepEqual(read({ ...PROD, ...change }), { ok: false, reason }, JSON.stringify(change));
    assert.deepEqual(email.passwordResetEmailReady({ ...PROD, ...change }), { ok: false, reason });
  }

  // Development: no key means nothing is sent; with a key, test sender and localhost are allowed.
  assert.deepEqual(read({ NODE_ENV: 'development' }), { ok: false, reason: 'missing_api_key' });
  assert.deepEqual(read({ RESEND_API_KEY: 'k' }), { ok: true, apiKey: 'k', from: 'onboarding@resend.dev', appBaseUrl: 'http://localhost:3000' });
  assert.equal(read({ RESEND_API_KEY: 'k', APP_BASE_URL: 'http://127.0.0.1:3001' }).appBaseUrl, 'http://127.0.0.1:3001');
  assert.deepEqual(email.passwordResetEmailReady(PROD), { ok: true });
});

test('a reset email goes through Resend with the link in the fragment and an idempotency key', async () => {
  const { email, calls } = fakeResend();
  const result = await email.sendPasswordResetEmail(resetInput({ name: '<img src=x onerror=alert(1)>' }), { env: PROD });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.keys, [PROD.RESEND_API_KEY]);
  assert.equal(calls.sends.length, 1);
  const { payload, options } = calls.sends[0];
  assert.deepEqual(options, { idempotencyKey: 'password-reset/abc' });
  assert.equal(payload.from, PROD.RESEND_FROM);
  assert.deepEqual(payload.to, ['person@example.com']);
  assert.equal(payload.subject, 'Reset your ForexOrbit Academy password');
  const url = `https://app.example.test/reset-password#token=${TOKEN}`;
  assert.equal(email.buildPasswordResetUrl('https://app.example.test', TOKEN), url);
  assert.ok(payload.text.includes(url));
  assert.ok(payload.html.includes(`href="${url}"`));
  assert.match(payload.text, /expires in 30 minutes/);
  assert.match(payload.html, /expires in 30 minutes/);
  assert.ok(payload.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(payload.html.includes('<img'), false, 'the name cannot inject markup');
  assert.match(payload.html, /ForexOrbit Academy/);
  assert.match(payload.text, /If you did not ask to reset your password/);
});

test('the password changed notice links to the forgot password page', async () => {
  const { email, calls } = fakeResend();
  const result = await email.sendPasswordChangedEmail({ to: 'person@example.com', name: 'Ada', idempotencyKey: 'password-changed/abc' }, { env: PROD });
  assert.deepEqual(result, { ok: true });
  const { payload, options } = calls.sends[0];
  assert.equal(payload.subject, 'Your ForexOrbit Academy password was changed');
  assert.deepEqual(options, { idempotencyKey: 'password-changed/abc' });
  assert.ok(payload.text.includes('https://app.example.test/forgot-password'));
  assert.match(payload.text, /signed out on every device/);
  assert.equal(payload.text.includes('reset-password#token='), false, 'the notice carries no reset link');
});

test('provider errors, exceptions and timeouts resolve to a reason; nothing is thrown', async () => {
  const errorResult = fakeResend(async () => ({ data: null, error: { name: 'validation_error', message: 'person@example.com is invalid' } }));
  assert.deepEqual(await errorResult.email.sendPasswordResetEmail(resetInput(), { env: PROD }), { ok: false, reason: 'send_failed' });

  const thrown = fakeResend(async () => { throw new Error(`network down for ${PROD.RESEND_API_KEY}`); });
  assert.deepEqual(await thrown.email.sendPasswordResetEmail(resetInput(), { env: PROD }), { ok: false, reason: 'send_failed' });

  const hanging = fakeResend(() => new Promise(() => {}));
  const started = Date.now();
  assert.deepEqual(await hanging.email.sendPasswordResetEmail(resetInput(), { env: PROD, timeoutMs: 30 }), { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 2000);

  const rejectedLater = fakeResend(() => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 60)));
  assert.deepEqual(await rejectedLater.email.sendPasswordChangedEmail({ to: 'p@example.com', idempotencyKey: 'k' }, { env: PROD, timeoutMs: 10 }), { ok: false, reason: 'timeout' });
  await new Promise((resolve) => setTimeout(resolve, 80)); // the late rejection is absorbed
});

test('without configuration nothing is sent and the Resend client is never created', async () => {
  const { email, calls } = fakeResend();
  for (const env of [{}, { NODE_ENV: 'production', RESEND_API_KEY: 'k' }, { ...PROD, RESEND_FROM: 'onboarding@resend.dev' }]) {
    assert.equal((await email.sendPasswordResetEmail(resetInput(), { env })).ok, false);
    assert.equal((await email.sendPasswordChangedEmail({ to: 'p@example.com', idempotencyKey: 'k' }, { env })).ok, false);
  }
  assert.deepEqual(calls.keys, []);
  assert.deepEqual(calls.sends, []);
});

test('logs never contain recipients, links, tokens, keys or provider messages', async () => {
  const runs = [
    fakeResend(),
    fakeResend(async () => ({ data: null, error: { name: 'validation_error', message: 'person@example.com rejected' } })),
    fakeResend(async () => { throw new Error(`boom ${TOKEN} person@example.com`); }),
    fakeResend(() => new Promise(() => {})),
  ];
  const { lines } = await captureConsole(async () => {
    for (const run of runs) {
      await run.email.sendPasswordResetEmail(resetInput(), { env: PROD, timeoutMs: 20 });
      await run.email.sendPasswordChangedEmail({ to: 'person@example.com', idempotencyKey: 'k' }, { env: PROD, timeoutMs: 20 });
    }
    await runs[0].email.sendPasswordResetEmail(resetInput(), { env: {} });
  });
  const logged = lines.join('\n');
  for (const secret of ['person@example.com', TOKEN, 'reset-password', PROD.RESEND_API_KEY, 'rejected', 'boom']) {
    assert.equal(logged.includes(secret), false, secret);
  }
  assert.ok(lines.length > 0, 'failures are still logged, by reason');
  for (const line of lines) assert.match(line, /^\{"event":"email_not_sent","kind":"(password_reset|password_changed)","reason":"[a-z_]+"(,"provider":"[a-z_]+")?\}$/);
});

test('the email module no longer logs links or falls back to request headers', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'email.ts'), 'utf8');
  assert.equal(/console\.(log|info)\(/.test(source), false);
  assert.equal(/\.headers|\breq\.|referer/i.test(source), false, 'links are built from APP_BASE_URL only');
  assert.equal(source.includes('isEmailConfigured'), false);
  for (const route of ['pages/api/auth/forgot-password.ts', 'lib/password-reset.js', 'lib/password-reset-route.ts']) {
    const text = fs.readFileSync(path.join(__dirname, '..', route), 'utf8');
    assert.equal(/\.headers\.(origin|host|referer)|headers\[['"](origin|host|referer)/i.test(text), false, route);
  }
});

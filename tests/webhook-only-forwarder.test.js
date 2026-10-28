'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const {
  createForwarder,
  listenLoopback,
  isLoopbackHost,
  WEBHOOK_PATH,
  MAX_BODY_BYTES,
  LISTEN_HOST,
} = require('../scripts/webhook-only-forwarder');

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

function send(port, { method = 'POST', path = WEBHOOK_PATH, headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function withForwarder(targetHandler, run) {
  const hits = [];
  const target = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      targetHandler(req, res);
    });
  });
  const targetPort = await listen(target);
  const logs = [];
  const forwarder = createForwarder({ targetHost: '127.0.0.1', targetPort, log: (e) => logs.push(e) });
  const port = await listen(forwarder);
  try {
    await run({ port, hits, logs });
  } finally {
    await close(forwarder);
    await close(target);
  }
}

const reply401 = (req, res) => {
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message: 'Invalid signature' }));
};

test('only POST to the webhook path is forwarded; every other method or path is refused locally', async () => {
  await withForwarder(reply401, async ({ port, hits }) => {
    for (const probe of [
      { method: 'GET', path: WEBHOOK_PATH },
      { method: 'PUT', path: WEBHOOK_PATH },
      { method: 'POST', path: '/' },
      { method: 'POST', path: '/api/auth/login' },
      { method: 'POST', path: '/api/paystack/webhook/extra' },
      { method: 'POST', path: '/api/paystack/WEBHOOK' },
      { method: 'GET', path: '/admin/purchases' },
      { method: 'POST', path: '/api/courses/abc/pay' },
    ]) {
      const res = await send(port, probe);
      assert.equal(res.status, 404, `${probe.method} ${probe.path}`);
    }
    assert.equal(hits.length, 0);
  });
});

test('the webhook body is forwarded byte for byte with only content-type and signature headers', async () => {
  await withForwarder(reply401, async ({ port, hits, logs }) => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'fo_c_test', note: 'é ₦' } });
    const res = await send(port, {
      path: `${WEBHOOK_PATH}?from=tunnel`,
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': 'abc123',
        cookie: 'token=should-not-pass',
        authorization: 'Bearer should-not-pass',
        'x-forwarded-for': '203.0.113.9',
      },
      body,
    });
    assert.equal(res.status, 401);
    assert.deepEqual(JSON.parse(res.body), { message: 'Invalid signature' });
    assert.equal(hits.length, 1);
    const [hit] = hits;
    assert.equal(hit.method, 'POST');
    assert.equal(hit.url, WEBHOOK_PATH);
    assert.equal(hit.body.toString(), body);
    assert.equal(hit.headers['x-paystack-signature'], 'abc123');
    assert.equal(hit.headers['content-type'], 'application/json');
    assert.equal(hit.headers.cookie, undefined);
    assert.equal(hit.headers.authorization, undefined);
    assert.equal(hit.headers['x-forwarded-for'], undefined);
    assert.ok(logs.every((e) => !JSON.stringify(e).includes('fo_c_test') && !JSON.stringify(e).includes('abc123')));
  });
});

test('oversized bodies are refused without forwarding, and an unavailable dev server gives 502', async () => {
  await withForwarder(reply401, async ({ port, hits }) => {
    const res = await send(port, { body: 'x'.repeat(MAX_BODY_BYTES + 1) }).catch(() => ({ status: 413 }));
    assert.equal(res.status, 413);
    assert.equal(hits.length, 0);
  });

  const closed = http.createServer();
  const deadPort = await listen(closed);
  await close(closed);
  const forwarder = createForwarder({ targetHost: '127.0.0.1', targetPort: deadPort });
  const port = await listen(forwarder);
  try {
    const res = await send(port, { body: '{}' });
    assert.equal(res.status, 502);
  } finally {
    await close(forwarder);
  }
});

test('query-string credentials and every other header stay on the public side, both ways', async () => {
  const leaky = (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=upstream', 'x-powered-by': 'Next.js' });
    res.end('{"received":true}');
  };
  await withForwarder(leaky, async ({ port, hits }) => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `${WEBHOOK_PATH}?token=abc&api_key=def&secret=ghi`,
          headers: {
            'content-type': 'application/json',
            'x-paystack-signature': 'sig',
            host: 'attacker.example',
            cookie: 'a=b',
            authorization: 'Basic eDp5',
            'proxy-authorization': 'Basic eDp5',
            'x-api-key': 'k',
            'x-forwarded-host': 'evil.example',
            'x-real-ip': '198.51.100.7',
            'user-agent': 'probe',
          },
        },
        (r) => {
          r.resume();
          r.on('end', () => resolve(r));
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['set-cookie'], undefined, 'upstream cookies are not relayed back');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].url, WEBHOOK_PATH, 'query string dropped');
    assert.deepEqual(
      Object.keys(hits[0].headers).sort(),
      ['connection', 'content-length', 'content-type', 'host', 'x-paystack-signature'],
      'only the body headers and the signature are forwarded'
    );
    assert.match(hits[0].headers.host, /^127\.0\.0\.1:\d+$/, 'the public Host header is replaced');
  });
});

test('a declared oversized body is refused before any of it is buffered or forwarded', async () => {
  await withForwarder(reply401, async ({ port, hits }) => {
    const status = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: WEBHOOK_PATH, headers: { 'content-length': String(MAX_BODY_BYTES + 1) } },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        }
      );
      req.on('error', () => resolve('closed'));
      req.write('x');
    });
    assert.ok(status === 413 || status === 'closed');
    assert.equal(hits.length, 0);
  });
});

test('a hung dev server gives 504 instead of holding the connection open', async () => {
  const sockets = new Set();
  const hung = http.createServer(() => {});
  hung.on('connection', (s) => sockets.add(s));
  const targetPort = await listen(hung);
  const forwarder = createForwarder({ targetHost: '127.0.0.1', targetPort, upstreamTimeoutMs: 150 });
  const port = await listen(forwarder);
  try {
    const started = Date.now();
    const res = await send(port, { body: '{}' });
    assert.equal(res.status, 504);
    assert.ok(Date.now() - started < 5000);
  } finally {
    await close(forwarder);
    for (const s of sockets) s.destroy();
    await close(hung);
  }
});

test('a client that disconnects mid-body does not crash the forwarder or reach the app', async () => {
  await withForwarder(reply401, async ({ port, hits }) => {
    await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`POST ${WEBHOOK_PATH} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"partial":`);
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 50);
      });
      socket.on('error', resolve);
    });
    const garbage = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write('NOT HTTP\r\n\r\n'));
      let data = '';
      socket.on('data', (d) => (data += d));
      socket.on('close', () => resolve(data));
      socket.on('error', () => resolve(data));
    });
    assert.match(garbage, /^HTTP\/1\.1 400/);
    const res = await send(port, { body: '{}' });
    assert.equal(res.status, 401, 'still serving after the aborted and malformed requests');
    assert.equal(hits.length, 1);
  });
});

test('it binds to 127.0.0.1 only and refuses any non-loopback target', async () => {
  assert.equal(LISTEN_HOST, '127.0.0.1');
  for (const host of ['10.0.0.5', '0.0.0.0', 'example.com', '192.168.1.10', '']) {
    assert.equal(isLoopbackHost(host), false, host);
    assert.throws(() => createForwarder({ targetHost: host }), /loopback/);
  }
  const server = createForwarder({ targetHost: '127.0.0.1', targetPort: 9 });
  const address = await listenLoopback(server, 0);
  try {
    assert.equal(address.address, '127.0.0.1');
  } finally {
    await close(server);
  }
});

function runCli(env) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'webhook-only-forwarder.js')], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return { child, output: () => out };
}

test('the command-line entry point listens on 127.0.0.1 and exits on a non-loopback target', async () => {
  const refused = runCli({ TARGET_HOST: 'example.com', FORWARDER_PORT: '0' });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      refused.child.kill();
      resolve('still running');
    }, 10000);
    refused.child.on('exit', (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  assert.equal(code, 1, 'a non-loopback target must stop the forwarder from starting');
  assert.match(refused.output(), /only targets a loopback/);

  const mock = http.createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"message":"Invalid signature"}');
  });
  const targetPort = await listen(mock);
  const cli = runCli({ TARGET_HOST: '127.0.0.1', TARGET_PORT: String(targetPort), FORWARDER_PORT: '0' });
  try {
    const line = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no startup line')), 10000);
      cli.child.stdout.on('data', () => {
        const match = cli.output().match(/\[forwarder\] (\S+):(\d+) -> /);
        if (match) {
          clearTimeout(timer);
          resolve({ host: match[1], port: Number(match[2]) });
        }
      });
    });
    assert.equal(line.host, '127.0.0.1');
    assert.equal((await send(line.port, { method: 'GET', path: '/' })).status, 404);
    assert.equal((await send(line.port, { body: '{}' })).status, 401);
    assert.doesNotMatch(cli.output(), /\{\}|Invalid signature/, 'logs carry no bodies');
  } finally {
    cli.child.kill();
    await close(mock);
  }
});

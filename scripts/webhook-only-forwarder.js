#!/usr/bin/env node
'use strict';
/**
 * Loopback forwarder for the one-off Paystack test-mode webhook delivery
 * (docs/audits/paystack-test-webhook-delivery-plan.md).
 *
 * Point the tunnel at this forwarder instead of the dev server. Only
 * `POST /api/paystack/webhook` reaches the app; any other method or path gets 404 here.
 * The query string is dropped, and only the body, `content-type` and `x-paystack-signature`
 * are passed on, so cookies, auth headers and URL parameters from the public side never
 * reach the app. Only the upstream status, `content-type` and body come back.
 * Logs carry no bodies, headers or URLs.
 *
 * Usage: node scripts/webhook-only-forwarder.js
 *   FORWARDER_PORT (default 3901) listens on 127.0.0.1 only.
 *   TARGET_HOST / TARGET_PORT (default localhost:3000) must be a loopback address.
 */
const http = require('http');

const WEBHOOK_PATH = '/api/paystack/webhook';
const MAX_BODY_BYTES = 256 * 1024;
const LISTEN_HOST = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const UPSTREAM_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 20000;

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || '').toLowerCase());
}

function createForwarder({
  targetHost = 'localhost',
  targetPort = 3000,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  log = () => {},
} = {}) {
  if (!isLoopbackHost(targetHost)) {
    throw new Error('The forwarder only targets a loopback dev server');
  }

  const server = http.createServer((req, res) => {
    let replied = false;
    const reply = (status, text) => {
      if (replied || res.headersSent) return;
      replied = true;
      log({ method: req.method, forwarded: false, status });
      res.writeHead(status, { 'content-type': 'text/plain', connection: 'close' });
      res.end(text);
    };
    req.on('error', () => {});

    const path = String(req.url || '').split('?')[0];
    if (req.method !== 'POST' || path !== WEBHOOK_PATH) {
      req.resume();
      reply(404, 'Not found');
      return;
    }

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reply(413, 'Payload too large');
      res.on('finish', () => req.destroy());
      return;
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reply(413, 'Payload too large');
        res.on('finish', () => req.destroy());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge || replied) return;
      const body = Buffer.concat(chunks);
      const headers = { 'content-length': body.length };
      if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
      if (req.headers['x-paystack-signature']) headers['x-paystack-signature'] = req.headers['x-paystack-signature'];

      const upstream = http.request(
        { host: targetHost, port: targetPort, method: 'POST', path: WEBHOOK_PATH, headers, timeout: upstreamTimeoutMs },
        (up) => {
          const out = [];
          up.on('data', (c) => out.push(c));
          up.on('error', () => reply(502, 'Upstream unavailable'));
          up.on('end', () => {
            if (replied) return;
            replied = true;
            log({ method: 'POST', forwarded: true, status: up.statusCode });
            res.writeHead(up.statusCode || 502, { 'content-type': up.headers['content-type'] || 'text/plain' });
            res.end(Buffer.concat(out));
          });
        }
      );
      upstream.on('timeout', () => {
        upstream.destroy();
        reply(504, 'Upstream timed out');
      });
      upstream.on('error', () => reply(502, 'Upstream unavailable'));
      upstream.end(body);
    });
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, 10000);
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  return server;
}

/** Binds to 127.0.0.1 only; the host is not configurable. */
function listenLoopback(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LISTEN_HOST, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.FORWARDER_PORT || 3901);
  const targetHost = process.env.TARGET_HOST || 'localhost';
  const targetPort = Number(process.env.TARGET_PORT || 3000);
  let server;
  try {
    server = createForwarder({
      targetHost,
      targetPort,
      log: (entry) => console.log(`[forwarder] ${new Date().toISOString()} ${JSON.stringify(entry)}`),
    });
  } catch (error) {
    console.error(`[forwarder] ${error.message}`);
    process.exit(1);
  }
  listenLoopback(server, port).then(
    (address) => console.log(`[forwarder] ${address.address}:${address.port} -> ${targetHost}:${targetPort}${WEBHOOK_PATH} (POST only)`),
    (error) => {
      console.error(`[forwarder] could not listen: ${error.code || error.message}`);
      process.exit(1);
    }
  );
}

module.exports = { createForwarder, listenLoopback, isLoopbackHost, WEBHOOK_PATH, MAX_BODY_BYTES, LISTEN_HOST };

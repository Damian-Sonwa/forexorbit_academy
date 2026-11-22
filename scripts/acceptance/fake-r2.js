/**
 * TEST DOUBLE ONLY: a local S3/R2-compatible object store for tests and acceptance runs. It checks
 * every presigned request the way S3 does (recomputes the SigV4 signature with the configured
 * secret, refuses expired or tampered links), stores objects in memory, and serves a "public
 * bucket" at /public/<key>. Never used by the application.
 */

const http = require('http');
const { presign } = require('../../lib/r2-storage');

function startFakeR2({ accessKeyId = 'test-access-key', secretAccessKey = 'test-secret-key' } = {}) {
  const objects = new Map();
  const log = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const end = (status, body = '', headers = {}) => { res.writeHead(status, headers); res.end(body); };
      // Public bucket (images): /public/<bucket>/<key>
      if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
        const key = decodeURIComponent(url.pathname.slice('/public/'.length));
        // Only the public (images) bucket is served without a signature.
        const found = objects.get(key);
        const obj = found && found.bucket === 'images' ? found : null;
        log.push({ method: 'PUBLIC', key, status: obj ? 200 : 404 });
        return obj ? end(200, obj.body, { 'Content-Type': obj.type }) : end(404);
      }
      const q = Object.fromEntries(url.searchParams);
      const signature = q['X-Amz-Signature'];
      const amzDate = q['X-Amz-Date'] || '';
      const expires = Number(q['X-Amz-Expires']);
      const when = amzDate ? new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`) : null;
      const extra = Object.fromEntries(Object.entries(q).filter(([k]) => !k.startsWith('X-Amz-')));
      const expected = when ? presign({ method: req.method, protocol: 'http:', host: req.headers.host, path: url.pathname, query: extra, accessKeyId, secretAccessKey, expires, now: when }).split('X-Amz-Signature=')[1] : null;
      const bucket = decodeURIComponent(url.pathname.split('/')[1] || '');
      const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
      if (!signature || signature !== expected) { log.push({ method: req.method, key, status: 403 }); return end(403, 'SignatureDoesNotMatch'); }
      if (!when || Date.now() > when.getTime() + expires * 1000) { log.push({ method: req.method, key, status: 403 }); return end(403, 'Request has expired'); }
      if (req.method === 'PUT') {
        objects.set(key, { bucket, body: Buffer.concat(chunks), type: req.headers['content-type'] || 'application/octet-stream', cache: req.headers['cache-control'] || '' });
        log.push({ method: 'PUT', key, status: 200 });
        return end(200);
      }
      if (req.method === 'GET') {
        const obj = objects.get(key);
        log.push({ method: 'GET', key, status: obj ? 200 : 404 });
        if (!obj) return end(404);
        return end(200, obj.body, { 'Content-Type': obj.type, ...(q['response-content-disposition'] ? { 'Content-Disposition': q['response-content-disposition'] } : {}) });
      }
      if (req.method === 'DELETE') { objects.delete(key); log.push({ method: 'DELETE', key, status: 204 }); return end(204); }
      return end(405);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      resolve({
        base, objects, log,
        env: { R2_ENDPOINT: base, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_IMAGES_BUCKET: 'images', R2_PUBLIC_BASE_URL: `${base}/public`, R2_FILES_BUCKET: 'files' },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startFakeR2 };

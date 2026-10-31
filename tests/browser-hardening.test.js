/**
 * Browser-side hardening: the server-side (no DOM) path of the HTML sanitizer, security headers,
 * and chat-attachment containment. The sanitizer's browser path is tested against a real DOM
 * (jsdom) in tests/html-sanitizer-dom.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadModule } = require('./helpers/ts-loader');
const upload = require('../lib/upload-safety');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const sanitizer = () => loadModule('lib/html-sanitizer.ts');

test('without a DOM (server rendering) markup is escaped, never trusted', () => {
  const { sanitizeHtml, sanitizeForStudentView } = sanitizer();
  assert.equal(typeof global.window, 'undefined');
  for (const html of ['<img src=x onerror=alert(1)>', '<a href="&#106;avascript:alert(1)">x</a>', '<iframe srcdoc="<script>alert(1)</script>">', '<svg><animate onbegin=alert(1)>']) {
    const out = sanitizeHtml(html);
    assert.equal(/<[a-z]/i.test(out), false, `no live tag in ${out}`);
    assert.ok(out.includes('&lt;'));
    assert.equal(/<[a-z]/i.test(sanitizeForStudentView(html)), false);
  }
  assert.equal(sanitizeHtml(''), '');
  assert.equal(sanitizeHtml(undefined), '');
});

test('plain-text previews drop markup, scripts and styles, and decode entities', () => {
  const { previewText } = loadModule('lib/plain-text.ts');
  assert.equal(previewText('<p>Support &amp; resistance</p><script>alert(1)</script><style>p{}</style><b>zones</b>'), 'Support & resistance zones');
  assert.equal(previewText('<p>Unclosed <script>alert(1)'), 'Unclosed');
  assert.equal(previewText(null), '');
});

test('every HTML sink renders through the sanitizer (or is a fixed script)', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx$/.test(entry.name)) files.push(rel);
    }
  };
  ['pages', 'components'].forEach(walk);
  let sinks = 0;
  for (const file of files) {
    const source = read(file);
    const re = /dangerouslySetInnerHTML=\{\{\s*__html:\s*([\s\S]{0,120}?)\}\}/g;
    for (const match of source.matchAll(re)) {
      sinks += 1;
      const value = match[1];
      const ok = /sanitize(Html|ForStudentView)\(/.test(value) || /^lesson(Desc|Body)Student\b/.test(value.trim()) || (file.endsWith('_document.tsx') && value.trim().startsWith('`(function(){'));
      assert.ok(ok, `${file}: ${value.trim().slice(0, 60)}`);
    }
  }
  assert.ok(sinks >= 15, `found ${sinks} sinks`);
  const lesson = read('pages/courses/[id]/lessons/[lessonId].tsx');
  assert.match(lesson, /const lessonDescStudent = sanitizeForStudentView\(/);
  assert.match(lesson, /const lessonBodyStudent = sanitizeForStudentView\(/);
});

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

test('every response carries the security headers; scripts and styles are not restricted', async () => {
  const config = require('../next.config.js');
  const rules = await config.headers();
  const all = rules.find((rule) => rule.source === '/:path*');
  assert.ok(all, 'a rule for every path');
  const headers = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
  assert.equal(headers['Content-Security-Policy'], "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['Strict-Transport-Security'], /^max-age=31536000/);
  assert.match(headers['Permissions-Policy'], /camera=\(self\), microphone=\(self\)/, 'consultation calls keep camera and microphone');
  assert.doesNotMatch(headers['Content-Security-Policy'], /script-src|style-src|default-src|connect-src|frame-src/, 'no policy that could block Paystack, fonts, ads, video or calls');
  // The existing cache rules are kept.
  assert.ok(rules.some((rule) => rule.source === '/service-worker.js'));
  assert.ok(rules.some((rule) => rule.source === '/manifest.json'));
});

// ---------------------------------------------------------------------------
// Chat attachments
// ---------------------------------------------------------------------------

test('chat attachments: pages, SVG and scripts are refused; ordinary media and documents are not', () => {
  for (const file of [
    { originalFilename: 'notes.html' }, { originalFilename: 'NOTES.HTM' }, { originalFilename: 'chart.svg' },
    { originalFilename: 'x.js' }, { originalFilename: 'evil.html.' }, { originalFilename: 'evil.html ' },
    { originalFilename: 'feed.xml' }, { originalFilename: 'run.exe' },
    { originalFilename: 'innocent.png', mimetype: 'text/html' }, { originalFilename: 'pic.jpg', mimetype: 'image/svg+xml' },
    { originalFilename: 'doc', mimetype: 'application/xhtml+xml; charset=utf-8' },
  ]) {
    assert.equal(upload.isActiveContent(file), true, JSON.stringify(file));
  }
  for (const file of [
    { originalFilename: 'chart.png', mimetype: 'image/png' }, { originalFilename: 'clip.mp4', mimetype: 'video/mp4' },
    { originalFilename: 'voice.webm', mimetype: 'audio/webm' }, { originalFilename: 'notes.pdf', mimetype: 'application/pdf' },
    { originalFilename: 'plan.docx' }, { originalFilename: 'data.csv', mimetype: 'text/csv' }, { originalFilename: 'no-extension' },
  ]) {
    assert.equal(upload.isActiveContent(file), false, JSON.stringify(file));
  }
});

test('stored attachment names are random and keep only a plain extension', () => {
  const names = new Set(Array.from({ length: 200 }, () => upload.storedFileName('photo.PNG')));
  assert.equal(names.size, 200);
  for (const name of names) assert.match(name, /^[0-9a-f]{32}\.png$/);
  assert.match(upload.storedFileName('weird.ext;rm -rf'), /^[0-9a-f]{32}$/, 'odd extensions are dropped');
  assert.match(upload.storedFileName('../../etc/passwd'), /^[0-9a-f]{32}$/);
  assert.match(upload.storedFileName(null), /^[0-9a-f]{32}$/);
});

test('both chat upload routes refuse active content before storing it and use random names', () => {
  for (const route of ['pages/api/community/messages/upload.ts', 'pages/api/consultations/messages/upload.ts']) {
    const source = read(route);
    const check = source.indexOf('isActiveContent({ originalFilename: file.originalFilename, mimetype: file.mimetype })');
    assert.ok(check > 0, route);
    assert.ok(check < source.indexOf('fs.renameSync(file.filepath, newPath)'), `${route}: checked before the file is moved into place`);
    assert.match(source, /const uniqueFilename = storedFileName\(file\.originalFilename\);/);
    assert.doesNotMatch(source, /Math\.random/);
  }
});

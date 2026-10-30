/**
 * Browser-side hardening: the HTML sanitizer used for lesson and course content, security headers,
 * and chat-attachment containment. The sanitizer's browser path runs against a minimal DOM whose
 * `children` list is live, like the browser's, which is what made the old loop skip elements.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadModule } = require('./helpers/ts-loader');
const upload = require('../lib/upload-safety');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

// ---------------------------------------------------------------------------
// Minimal DOM: elements, text, attributes, a live `children` list, replaceChild.
// ---------------------------------------------------------------------------

class TextNode {
  constructor(text) { this.nodeType = 3; this.textContent = text; this.parentNode = null; }
}

class El {
  constructor(tag, attrs = {}, kids = []) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.childNodes = [];
    this.parentNode = null;
    kids.forEach((k) => this.appendChild(typeof k === 'string' ? new TextNode(k) : k));
  }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  /** Live, as in the browser: every access reflects the current children. */
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get attributes() { return Array.from(this.attrs, ([name, value]) => ({ name, value })); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  replaceChild(next, old) {
    const at = this.childNodes.indexOf(old);
    this.childNodes[at] = next;
    next.parentNode = this;
    old.parentNode = null;
  }
}

function withDocument(fn) {
  const saved = global.document;
  global.document = { createTextNode: (text) => new TextNode(text) };
  try {
    return fn();
  } finally {
    if (saved === undefined) delete global.document;
    else global.document = saved;
  }
}

const sanitizer = () => loadModule('lib/html-sanitizer.ts');
const ALLOWED_TAGS = ['p', 'b', 'a', 'img', 'div', 'span'];
const ALLOWED_ATTRS = { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt'], div: ['class'], span: ['class'] };

test('every element is checked, including the one after a removed element', () => {
  const { sanitizeElement } = sanitizer();
  withDocument(() => {
    const evilImg = new El('img', { src: 'x.png', onerror: 'alert(document.cookie)' });
    const secondImg = new El('img', { src: 'y.png', onload: 'steal()' });
    const root = new El('div', {}, [
      new El('script', {}, ['alert(1)']),
      evilImg,
      new El('iframe', { src: 'https://evil.example' }),
      secondImg,
      new El('p', { style: 'x', onclick: 'y' }, [new El('object', { data: 'x.swf' }), new El('b', { onmouseover: 'z' }, ['ok'])]),
    ]);
    sanitizeElement(root, ALLOWED_TAGS, ALLOWED_ATTRS);

    assert.deepEqual(root.children.map((c) => c.tagName), ['IMG', 'IMG', 'P'], 'script and iframe became text');
    assert.equal(evilImg.getAttribute('onerror'), null, 'the element right after a removed one is cleaned');
    assert.equal(secondImg.getAttribute('onload'), null);
    const p = root.children[2];
    assert.deepEqual([p.getAttribute('style'), p.getAttribute('onclick')], [null, null]);
    assert.deepEqual(p.children.map((c) => c.tagName), ['B'], 'nested disallowed element removed');
    assert.equal(p.children[0].getAttribute('onmouseover'), null, 'nested elements after a removal are cleaned too');
  });
});

test('links and images keep only safe URLs; new-tab links cannot reach the opener', () => {
  const { sanitizeElement, isValidUrl } = sanitizer();
  for (const url of ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', '\u0001javascript:x', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', 'blob:x']) {
    assert.equal(isValidUrl(url), false, JSON.stringify(url));
  }
  for (const url of ['https://example.com/a', 'http://example.com', '/lessons/1', '#top', 'page.html', '//cdn.example.com/x.png', 'mailto:a@b.co', 'tel:+2348000000000']) {
    assert.equal(isValidUrl(url), true, url);
  }
  withDocument(() => {
    const bad = new El('a', { href: ' javascript:alert(1)', target: '_blank' }, ['x']);
    const good = new El('a', { href: 'https://example.com', target: '_blank', rel: 'opener' }, ['y']);
    const img = new El('img', { src: 'data:image/svg+xml,<svg onload=alert(1)>' });
    const root = new El('div', {}, [bad, good, img]);
    sanitizeElement(root, ALLOWED_TAGS, ALLOWED_ATTRS);
    assert.equal(bad.getAttribute('href'), null);
    assert.equal(good.getAttribute('href'), 'https://example.com');
    assert.equal(good.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(img.getAttribute('src'), null);
  });
});

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

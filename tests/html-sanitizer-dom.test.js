/**
 * The lesson and course HTML sanitizer in a real DOM (jsdom), the way it runs in the browser.
 *
 * Regression for the Phase 1-3 sanitizer: it walked the parsed document from <html>, removed
 * <head> and <body> (not on the allowlist) and then failed, so every lesson showed escaped
 * markup. The version before that skipped <body> and sanitized nothing. These tests go through
 * the full parse path with ordinary lesson content and with attack payloads.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadModule } = require('./helpers/ts-loader');

function inBrowser(fn) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'https://forexorbit.test/' });
  const saved = { window: global.window, document: global.document };
  global.window = dom.window;
  global.document = dom.window.document;
  try {
    return fn(loadModule('lib/html-sanitizer.ts'), dom.window);
  } finally {
    if (saved.window === undefined) delete global.window;
    else global.window = saved.window;
    if (saved.document === undefined) delete global.document;
    else global.document = saved.document;
    dom.window.close();
  }
}

/** Parses sanitized output back into a fragment so assertions read the DOM, not strings. */
function parse(win, html) {
  const box = win.document.createElement('div');
  box.innerHTML = html;
  return box;
}

function assertInert(box, label) {
  for (const el of box.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      assert.equal(/^on/i.test(attr.name), false, `handler kept: ${label}`);
      assert.notEqual(attr.name, 'style', `style kept: ${label}`);
      assert.notEqual(attr.name, 'autofocus', label);
      if (attr.name === 'href' || attr.name === 'src') {
        assert.equal(/^\s*(javascript|vbscript|data):/i.test(attr.value), false, `unsafe URL kept: ${label}`);
      }
    }
  }
}

test('ordinary lesson content keeps its formatting (not escaped, not a whole document)', () => {
  inBrowser(({ sanitizeHtml }, win) => {
    const lesson = [
      '<h2>Support and resistance</h2>',
      '<p class="ql-align-center">Price <strong>often</strong> <em>reacts</em> at <u>prior</u> levels.</p>',
      '<ul><li>Higher highs</li><li class="ql-indent-1">Higher lows</li></ul>',
      '<ol><li>Mark the level</li><li>Wait for confirmation</li></ol>',
      '<blockquote>Trade the plan.</blockquote>',
      '<pre class="ql-syntax">EURUSD 1.0850</pre>',
      '<p><img src="https://res.cloudinary.com/demo/image/upload/v1/forexorbit/instructors/chart.png" alt="Chart" width="600"></p>',
      '<p><a href="https://www.babypips.com/learn" target="_blank">Read more</a> or <a href="/courses/abc">the course</a> or <a href="#top">top</a></p>',
      '<table><tbody><tr><td colspan="2">Pair</td></tr></tbody></table>',
    ].join('');
    const out = sanitizeHtml(lesson);
    assert.equal(out.includes('&lt;'), false, 'markup is not escaped');
    assert.equal(/<(html|head|body)\b/i.test(out), false, 'the result is the fragment, not a document');
    const box = parse(win, out);
    assert.equal(box.querySelector('h2').textContent, 'Support and resistance');
    assert.equal(box.querySelector('p').getAttribute('class'), 'ql-align-center');
    assert.deepEqual(Array.from(box.querySelectorAll('strong, em, u')).map((n) => n.tagName), ['STRONG', 'EM', 'U']);
    assert.equal(box.querySelectorAll('ul li').length, 2);
    assert.equal(box.querySelectorAll('ol li').length, 2);
    assert.ok(box.querySelector('blockquote'));
    assert.ok(box.querySelector('pre'));
    const img = box.querySelector('img');
    assert.equal(img.getAttribute('src'), 'https://res.cloudinary.com/demo/image/upload/v1/forexorbit/instructors/chart.png');
    assert.equal(img.getAttribute('alt'), 'Chart');
    const links = Array.from(box.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    assert.deepEqual(links, ['https://www.babypips.com/learn', '/courses/abc', '#top']);
    assert.equal(box.querySelector('a[target="_blank"]').getAttribute('rel'), 'noopener noreferrer');
    assert.equal(box.querySelector('td').getAttribute('colspan'), '2');
  });
});

test('scripts, event handlers, frames and active elements are removed', () => {
  inBrowser(({ sanitizeHtml }, win) => {
    const payloads = [
      '<script>alert(1)</script><p>after</p>',
      '<img src=x onerror=alert(1)>',
      '<b>x</b><img src="y.png" onload="steal()">',
      '<p onclick="y" style="background:url(javascript:alert(1))">p</p>',
      '<iframe src="https://evil.example"></iframe>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<svg><animate onbegin=alert(1) attributeName=x dur=1s></svg>',
      '<object data="x.swf"></object><embed src="x.swf">',
      '<form action="https://evil.example"><input name=p><button>go</button></form>',
      '<style>body{display:none}</style>',
      '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
      '<div><p>nested <span onmouseover="z">ok</span></p></div>',
      '<a href="https://ok.example" onfocus="x" autofocus>link</a>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<base href="https://evil.example/">',
    ];
    for (const html of payloads) {
      const out = sanitizeHtml(html);
      const box = parse(win, out);
      assert.equal(box.querySelector('script, iframe, svg, object, embed, form, input, button, style, math, meta, base'), null, `${html} -> ${out}`);
      assertInert(box, `${html} -> ${out}`);
    }
    assert.equal(sanitizeHtml('<script>alert(1)</script><p>after</p>'), '<p>after</p>');
    assert.equal(sanitizeHtml('<div><p>nested <span onmouseover="z">ok</span></p></div>'), '<div><p>nested <span>ok</span></p></div>');
  });
});

test('dangerous URL schemes are removed from links and images, including obfuscated forms', () => {
  inBrowser(({ sanitizeHtml, isValidUrl }, win) => {
    for (const url of ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', '\u0001javascript:x', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', 'blob:x']) {
      assert.equal(isValidUrl(url), false, JSON.stringify(url));
    }
    const hrefs = [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '&#106;avascript:alert(1)', 'java&#x09;script:alert(1)',
      ' javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'file:///etc/passwd', 'jav&#x0A;ascript:alert(1)',
    ];
    for (const href of hrefs) {
      const box = parse(win, sanitizeHtml(`<a href="${href}">x</a>`));
      assert.equal(box.querySelector('a').getAttribute('href'), null, href);
      assert.equal(box.querySelector('a').textContent, 'x', 'the link text stays');
    }
    for (const src of ['data:image/svg+xml,<svg onload=alert(1)>', 'data:image/png;base64,AAAA', 'javascript:alert(1)']) {
      const box = parse(win, sanitizeHtml(`<img src="${src}" alt="a">`));
      const img = box.querySelector('img');
      assert.equal(img && img.getAttribute('src'), null, src);
    }
    for (const href of ['https://example.com/a', 'http://example.com', 'mailto:help@forexorbit.test', 'tel:+2348000000000', '/lessons/1', 'page.html', '#section']) {
      const box = parse(win, sanitizeHtml(`<a href="${href}">x</a>`));
      assert.equal(box.querySelector('a').getAttribute('href'), href);
    }
  });
});

test('malformed markup is repaired without reviving anything executable', () => {
  inBrowser(({ sanitizeHtml }, win) => {
    const cases = [
      '<p>Unclosed <b>bold',
      '<p>Broken <img src=x onerror=alert(1)',
      '<<script>script>alert(1)<</script>/script>',
      '<p><a href="javascript:alert(1)"<b>x</b></a>',
      '</p></div>stray<div>',
      '<scr<script>ipt>alert(1)</script>',
      '<!--<img src=x onerror=alert(1)>-->text',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    ];
    for (const html of cases) {
      const out = sanitizeHtml(html);
      const box = parse(win, out);
      assert.equal(box.querySelector('script, noscript'), null, out);
      assertInert(box, `${html} -> ${out}`);
    }
    assert.equal(sanitizeHtml('<p>Unclosed <b>bold'), '<p>Unclosed <b>bold</b></p>');
  });
});

test('disallowed but harmless elements keep their text; the student view also strips visual aids', () => {
  inBrowser(({ sanitizeHtml, sanitizeForStudentView }) => {
    assert.equal(sanitizeHtml('<section><p>Kept</p></section><font color="red">red</font>'), '<p>Kept</p>red');
    const html = '<p>Lesson</p><p><img src="https://res.cloudinary.com/demo/image/upload/forexorbit/visual-aids/a.png"></p><p><img src="x" onerror="alert(1)"></p>';
    const out = sanitizeForStudentView(html);
    assert.equal(out.includes('visual-aids'), false);
    assert.equal(/onerror/i.test(out), false);
    assert.ok(out.startsWith('<p>Lesson</p>'));
  });
});

test('sanitizing is stable: cleaning clean output again changes nothing', () => {
  inBrowser(({ sanitizeHtml }) => {
    const once = sanitizeHtml('<h3>Risk</h3><p>Use a <a href="https://example.com" target="_blank">stop</a>.</p><img src="javascript:x"><p onclick=x>t</p>');
    assert.equal(sanitizeHtml(once), once);
  });
});

test('per-call options still narrow the allowlist', () => {
  inBrowser(({ sanitizeHtml }) => {
    assert.equal(sanitizeHtml('<p><b>x</b><a href="https://e.com">y</a></p>', { allowedTags: ['p', 'b'] }), '<p><b>x</b>y</p>');
    assert.equal(sanitizeHtml('<p data-list="bullet">x</p>', { allowDataAttributes: false }), '<p>x</p>');
    assert.equal(sanitizeHtml('<p data-list="bullet">x</p>'), '<p data-list="bullet">x</p>');
  });
});

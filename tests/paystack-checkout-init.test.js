/**
 * Paystack checkout start-up: public key validation, a plain body script (no parent form and no
 * data-* attributes, so Paystack never enters its embedded-form mode), one shared load for
 * preload and click, clean recovery after a failed preload, and the click guards in the
 * component. No network or Paystack: the DOM is a minimal stand-in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function loadTs(file) {
  const filename = path.join(ROOT, file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (id) => (id.startsWith('@/') ? require(path.join(ROOT, id.slice(2))) : require(id));
  mod._compile(outputText, filename);
  return mod.exports;
}

const { normalizePaystackPublicKey } = loadTs('lib/paystack-public-key.ts');

test('valid public keys pass, trimmed and with stray surrounding quotes removed', () => {
  assert.equal(normalizePaystackPublicKey('pk_live_abc123XYZ'), 'pk_live_abc123XYZ');
  assert.equal(normalizePaystackPublicKey('pk_test_abc123'), 'pk_test_abc123');
  assert.equal(normalizePaystackPublicKey('  pk_live_abc123 \n'), 'pk_live_abc123');
  assert.equal(normalizePaystackPublicKey('"pk_live_abc123"'), 'pk_live_abc123');
  assert.equal(normalizePaystackPublicKey("'pk_test_abc123'"), 'pk_test_abc123');
});

test('missing, empty or malformed keys are refused before Paystack is touched', () => {
  for (const bad of [
    undefined,
    null,
    '',
    '   ',
    '""',
    'undefined',
    'sk_live_abc123',
    'sk_test_abc123',
    'pk_live_',
    'pk_prod_abc123',
    'pk_live_abc 123',
    '"pk_live_abc123',
    'pk_live_abc123"',
    42,
  ]) {
    assert.equal(normalizePaystackPublicKey(bad), null, String(bad));
  }
});

/** Just enough DOM for lib/paystack-inline-script.ts. */
function fakeDom() {
  class FakeElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.attributes = {};
      this.children = [];
      this.parentElement = null;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    remove() {
      if (!this.parentElement) return;
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  const body = new FakeElement('body');
  const created = [];
  const document = {
    body,
    createElement: (tag) => {
      const el = new FakeElement(tag);
      created.push(el);
      return el;
    },
  };
  return { document, created, scripts: () => body.children.filter((el) => el.tagName === 'SCRIPT') };
}

async function withDom(run) {
  const dom = fakeDom();
  const saved = { window: global.window, document: global.document };
  global.window = {};
  global.document = dom.document;
  try {
    await run(dom, loadTs('lib/paystack-inline-script.ts'));
  } finally {
    Object.assign(global, saved);
  }
}

const definePaystack = () => {
  global.window.PaystackPop = { setup: () => ({ openIframe() {} }) };
};

test('the script is a plain child of document.body with no data-* attributes and no form', () =>
  withDom(async (dom, { loadPaystackInline }) => {
    const load = loadPaystackInline(1000);
    const [script] = dom.scripts();
    assert.equal(script.parentElement, dom.document.body);
    assert.deepEqual(Object.keys(script.attributes), [], 'no attributes set, data-* or otherwise');
    assert.equal(script.src, 'https://js.paystack.co/v1/inline.js');
    assert.equal(script.async, true);
    assert.ok(!dom.created.some((el) => el.tagName === 'FORM'), 'no form is ever created');
    definePaystack();
    script.onload();
    await load;
  }));

test('preload and a click during the preload share one load and one script tag', () =>
  withDom(async (dom, { loadPaystackInline, preloadPaystackInline }) => {
    preloadPaystackInline();
    const click = loadPaystackInline(1000);
    const secondClick = loadPaystackInline(1000);
    assert.equal(click, secondClick, 'the same promise');
    assert.equal(dom.scripts().length, 1);
    definePaystack();
    dom.scripts()[0].onload();
    await click;
    // Once loaded, later checkouts start at once and add nothing.
    await loadPaystackInline(1000);
    assert.equal(dom.scripts().length, 1);
  }));

test('a failed preload is silent and the click requests the script again', () =>
  withDom(async (dom, { loadPaystackInline, preloadPaystackInline }) => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      preloadPaystackInline();
      const [failed] = dom.scripts();
      failed.onerror();
      await new Promise((r) => setImmediate(r));
      assert.equal(dom.scripts().length, 0, 'the failed tag is removed');

      const click = loadPaystackInline(1000);
      const [fresh] = dom.scripts();
      assert.notEqual(fresh, failed);
      assert.match(fresh.src, /^https:\/\/js\.paystack\.co\/v1\/inline\.js\?retry=1$/);
      definePaystack();
      fresh.onload();
      await click;
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(unhandled, [], 'a preload failure is never an unhandled rejection');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }));

test('a preload that times out leaves no tag behind and a later click can still succeed', () =>
  withDom(async (dom, { loadPaystackInline }) => {
    await assert.rejects(loadPaystackInline(20), /taking too long/);
    assert.equal(dom.scripts().length, 0);
    const retry = loadPaystackInline(1000);
    definePaystack();
    dom.scripts()[0].onload();
    await retry;
  }));

test('checkout start is guarded against bad keys, double starts and leaving the page', () => {
  const component = read('components/monetization/PaystackCourseUnlock.tsx');
  // The key is validated once and Paystack is never loaded or set up without it.
  assert.match(component, /const publicKey = normalizePaystackPublicKey\(process\.env\.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY\);/);
  assert.match(component, /if \(publicKey\) preloadPaystackInline\(\);/);
  assert.match(component, /if \(!publicKey\) \{\s*setError\('Payments are not available right now\.'\);\s*return;\s*\}/);
  assert.match(component, /key: publicKey,/);
  // A synchronous lock stops rapid clicks before React re-renders the disabled button.
  assert.match(component, /if \(starting\.current\) return;/);
  assert.match(component, /starting\.current = true;/);
  assert.match(component, /finally \{\s*starting\.current = false;\s*\}/);
  // Nothing opens after the user has left the page.
  assert.match(component, /await loadPaystackInline\(\);\s*if \(!mounted\.current\) return;/);
  assert.match(component, /if \(!mounted\.current\) return;\s*if \(init\.alreadyOwned\)/);
  // The key never reaches a log.
  assert.doesNotMatch(component, /console\.[a-z]+\([^)]*publicKey/);
  assert.doesNotMatch(read('lib/paystack-public-key.ts'), /console\./);
  assert.doesNotMatch(read('lib/paystack-inline-script.ts'), /console\./);
});

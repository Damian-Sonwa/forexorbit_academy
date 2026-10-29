/**
 * Checkout must always leave its loading state. Covers the three waits that could previously
 * hang forever: the Paystack script load (including a retry after a failed load), a stalled
 * confirmation request, and the page refresh after a confirmed unlock. No network or Paystack:
 * the DOM is a minimal stand-in and requests are stubs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const checkout = require('../lib/course-checkout');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const noWait = { delays: [0, 0, 0], sleep: async () => {} };

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

/** Just enough DOM for lib/paystack-inline-script.ts: a body, a host form, and script tags. */
function fakeDom() {
  class FakeElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.attributes = {};
      this.children = [];
      this.parentElement = null;
      this.style = {};
      this.elements = [];
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    appendChild(child) {
      if (child.parentElement) child.remove();
      child.parentElement = this;
      this.children.push(child);
      created.push(child);
      return child;
    }
    remove() {
      if (!this.parentElement) return;
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
    addEventListener() {}
  }
  class FakeForm extends FakeElement {}
  const created = [];
  const body = new FakeElement('body');
  const all = () => {
    const out = [];
    const walk = (node) => node.children.forEach((child) => (out.push(child), walk(child)));
    walk(body);
    return out;
  };
  const matcher = (selector) => {
    const [, tag, attr, value] = selector.match(/^(\w+)\[([\w-]+)="([^"]*)"\]$/);
    return (el) => el.tagName === tag.toUpperCase() && el.getAttribute(attr) === value;
  };
  const document = {
    body,
    createElement: (tag) => (tag === 'form' ? new FakeForm(tag) : new FakeElement(tag)),
    querySelector: (selector) => all().find(matcher(selector)) || null,
    querySelectorAll: (selector) => all().filter(matcher(selector)),
  };
  return { document, FakeForm, scripts: () => all().filter((el) => el.tagName === 'SCRIPT'), created };
}

function withDom(run) {
  const dom = fakeDom();
  const saved = { window: global.window, document: global.document, HTMLFormElement: global.HTMLFormElement };
  global.window = {};
  global.document = dom.document;
  global.HTMLFormElement = dom.FakeForm;
  const restore = () => Object.assign(global, saved);
  return Promise.resolve()
    .then(() => run(dom, loadTs('lib/paystack-inline-script.ts')))
    .finally(restore);
}

test('the Paystack script load times out instead of waiting forever', () =>
  withDom(async (dom, { loadPaystackInline }) => {
    const started = Date.now();
    await assert.rejects(loadPaystackInline(30), /taking too long/);
    assert.ok(Date.now() - started < 1000);
    assert.equal(dom.scripts().length, 0, 'the stalled tag is removed');
  }));

test('a retry after a failed script load requests the script again and can succeed', () =>
  withDom(async (dom, { loadPaystackInline }) => {
    const first = loadPaystackInline(1000);
    const [failed] = dom.scripts();
    failed.onerror();
    await assert.rejects(first, /failed to load/);
    assert.equal(dom.scripts().length, 0);

    const second = loadPaystackInline(1000);
    const [fresh] = dom.scripts();
    assert.notEqual(fresh, failed, 'a new script tag, not the spent one');
    assert.notEqual(fresh.src, failed.src, 'a distinct URL, so the browser cannot reuse the stalled request');
    assert.match(fresh.src, /^https:\/\/js\.paystack\.co\/v1\/inline\.js\?retry=\d+$/);
    global.window.PaystackPop = { setup: () => ({ openIframe() {} }) };
    fresh.onload();
    await second;
  }));

test('a script that loads without defining PaystackPop is a failure, not a hang', () =>
  withDom(async (dom, { loadPaystackInline }) => {
    const load = loadPaystackInline(1000);
    dom.scripts()[0].onload();
    await assert.rejects(load, /failed to load/);
  }));

test('concurrent loads share one script tag', () =>
  withDom(async (dom, { loadPaystackInline }) => {
    const a = loadPaystackInline(1000);
    const b = loadPaystackInline(1000);
    assert.equal(dom.scripts().length, 1);
    global.window.PaystackPop = { setup: () => ({ openIframe() {} }) };
    dom.scripts()[0].onload();
    await Promise.all([a, b]);
  }));

test('confirmation requests that time out are retried and end as pending', async () => {
  let calls = 0;
  const post = async () => {
    calls += 1;
    throw Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' });
  };
  const result = await checkout.confirmCourseCheckout({ post, courseId: 'c1', reference: 'ref_abc123', ...noWait });
  assert.equal(calls, 4);
  assert.equal(result.state, 'pending');
  assert.equal(result.retryable, true);
});

test('each checkout terminal state is reached: unlocked, pending, failed', async () => {
  const unlocked = await checkout.confirmCourseCheckout({
    post: async () => ({ success: true, unlocked: true }),
    courseId: 'c1',
    reference: 'ref_abc123',
    ...noWait,
  });
  assert.equal(unlocked.state, 'unlocked');

  const pending = await checkout.confirmCourseCheckout({
    post: async () => {
      throw { response: { status: 503, data: {} } };
    },
    courseId: 'c1',
    reference: 'ref_abc123',
    ...noWait,
  });
  assert.equal(pending.state, 'pending');

  const failed = await checkout.confirmCourseCheckout({
    post: async () => {
      throw { response: { status: 400, data: { code: 'payment_not_successful', message: 'Not paid' } } };
    },
    courseId: 'c1',
    reference: 'ref_abc123',
    ...noWait,
  });
  assert.equal(failed.state, 'failed');
});

test('a page refresh that never finishes does not hold an unlocked checkout open', async () => {
  const result = await checkout.settleCourseCheckout({
    post: async () => ({ success: true, unlocked: true }),
    storage: null,
    courseId: 'c-hang',
    reference: 'ref_hang01',
    onUnlocked: () => new Promise(() => {}),
    refreshTimeoutMs: 20,
    ...noWait,
  });
  assert.equal(result.state, 'unlocked');
  assert.equal(result.refreshed, false);
});

test('a page refresh that throws still reports the unlock instead of rejecting', async () => {
  const result = await checkout.settleCourseCheckout({
    post: async () => ({ success: true, unlocked: true }),
    storage: null,
    courseId: 'c-throw',
    reference: 'ref_throw01',
    onUnlocked: async () => {
      throw new Error('refetch failed');
    },
    ...noWait,
  });
  assert.equal(result.state, 'unlocked');
  assert.equal(result.refreshed, false);
});

test('a successful refresh leaves the result unchanged', async () => {
  let refreshed = 0;
  const result = await checkout.settleCourseCheckout({
    post: async () => ({ success: true, unlocked: true }),
    storage: null,
    courseId: 'c-ok',
    reference: 'ref_ok0001',
    onUnlocked: async () => {
      refreshed += 1;
    },
    ...noWait,
  });
  assert.equal(refreshed, 1);
  assert.equal(result.state, 'unlocked');
  assert.equal('refreshed' in result, false);
});

test('checkout requests carry timeouts and the component never decides access itself', () => {
  const source = read('components/monetization/PaystackCourseUnlock.tsx');
  assert.match(source, /'\/payments\/paystack\/init-course',[\s\S]{0,40}\{ courseId \},[\s\S]{0,40}timeout: INIT_REQUEST_TIMEOUT_MS/);
  assert.match(source, /apiClient\.post\(url, body, \{ timeout: CONFIRM_REQUEST_TIMEOUT_MS \}\)/);
  assert.doesNotMatch(source, /setUnlocked|unlocked:\s*true/, 'access comes only from the server confirmation');
  // Closing the Paystack window only returns to idle; it never confirms.
  assert.match(source, /onClose: \(\) => setPhase\(\(current\) => \(current === 'paying' \? 'idle' : current\)\)/);
});

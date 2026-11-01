/**
 * useLesson loading state (hooks/useLesson.ts).
 *
 * Regression: a lesson that loaded successfully (200), a paywall answer (403) and a missing
 * lesson (404) all returned before `setLoading(false)`, so the lesson page stayed on its skeleton
 * forever. Only a 401 (the API client is redirecting to sign-in) may keep the loading state.
 *
 * Phase 7 adds: a read-rule refusal (not enrolled) is its own actionable state, a network
 * failure is retryable and recovers on retry, a slow answer for a lesson the student already
 * left never replaces the current one, and a silent refresh keeps the lesson on screen.
 *
 * The TypeScript hook is transpiled in memory and run with a minimal re-rendering stand-in for
 * React's hooks (state and refs persist across renders by call order) and a mocked API client.
 * No browser, network or database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'hooks', 'useLesson.ts');
const LESSON_ID = '650000000000000000000001';

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
}

function compile(file, requireFn) {
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = requireFn;
  mod._compile(transpile(file), file);
  return mod.exports;
}

/** `respond(url, callIndex)` returns (or throws) the API client's answer. */
function loadHook(respond) {
  const slots = [];
  let cursor = 0;
  const slot = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
    return slots[index];
  };
  const fakeReact = {
    useState(initial) {
      const s = slot(initial);
      return [s.value, (next) => { s.value = typeof next === 'function' ? next(s.value) : next; }];
    },
    useRef(initial) {
      const s = slot(() => ({ current: initial }));
      return s.value;
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
  };
  let calls = 0;
  const fakeApi = {
    apiClient: { getAllowingError: async (url) => respond(url, calls++) },
    isUnauthorizedError: (err) => Boolean(err && err.response && err.response.status === 401),
  };
  const lessonRequest = compile(path.join(ROOT, 'lib', 'lesson-request.ts'), require);
  const hooks = compile(SOURCE, (id) => {
    if (id === 'react') return fakeReact;
    if (id === '@/lib/api-client') return fakeApi;
    if (id === '@/lib/lesson-request') return lessonRequest;
    return require(id);
  });
  return {
    render(lessonId = LESSON_ID) {
      cursor = 0;
      return hooks.useLesson(lessonId, true);
    },
  };
}

async function finalState(respond) {
  const hook = loadHook(respond);
  await hook.render().refetch();
  return hook.render();
}

test('a lesson that loads clears the loading state', async () => {
  const result = await finalState(() => ({ ok: true, status: 200, data: { _id: LESSON_ID, title: 'Intro' } }));
  assert.equal(result.loading, false);
  assert.equal(result.status, 'ready');
  assert.equal(result.lesson.title, 'Intro');
});

test('a paywall answer clears the loading state and shows the access message', async () => {
  const result = await finalState(() => ({ ok: false, status: 403, data: { access: false, locked: true, message: 'Unlock to continue' } }));
  assert.equal(result.loading, false);
  assert.equal(result.status, 'locked');
  assert.equal(result.accessDenied.message, 'Unlock to continue');
});

test('a missing lesson and a server error clear the loading state', async () => {
  for (const response of [{ ok: false, status: 404, data: {} }, { ok: false, status: 500, data: { message: 'x' } }]) {
    const result = await finalState(() => response);
    assert.equal(result.loading, false, String(response.status));
    assert.ok(result.error, String(response.status));
  }
  const thrown = await finalState(() => { throw new Error('network'); });
  assert.equal(thrown.loading, false);
  assert.equal(thrown.status, 'error');
});

test('a 401 keeps the loading state while the API client redirects to sign-in', async () => {
  const result = await finalState(() => ({ ok: false, status: 401, data: {} }));
  assert.equal(result.loading, true);
  assert.equal(result.error, null);
});

test('Phase 7: a read-rule refusal (not enrolled) is an actionable state, not a retryable error', async () => {
  const result = await finalState(() => ({ ok: false, status: 403, data: { error: 'Unable to access lesson' } }));
  assert.equal(result.status, 'forbidden');
  assert.match(result.error, /Enroll in this course/);
  assert.equal(result.lesson, null);
});

test('Phase 7: a failed request is recoverable and retrying it loads the lesson', async () => {
  const hook = loadHook((url, call) => {
    if (call === 0) throw new Error('Network Error');
    return { ok: true, status: 200, data: { _id: LESSON_ID, title: 'Recovered' } };
  });
  await hook.render().refetch();
  const failed = hook.render();
  assert.deepEqual([failed.status, failed.loading, failed.lesson], ['error', false, null]);
  assert.ok(failed.error);
  await failed.refetch();
  const recovered = hook.render();
  assert.deepEqual([recovered.status, recovered.error, recovered.lesson.title], ['ready', null, 'Recovered']);
});

test('Phase 7: a slow answer for a lesson the student already left never replaces the current one', async () => {
  const OTHER = '650000000000000000000002';
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const hook = loadHook(async (url) => {
    if (url.includes(LESSON_ID)) {
      await slow;
      return { ok: true, status: 200, data: { _id: LESSON_ID, title: 'Old lesson' } };
    }
    return { ok: true, status: 200, data: { _id: OTHER, title: 'New lesson' } };
  });
  const first = hook.render(LESSON_ID).refetch();
  await hook.render(OTHER).refetch();
  releaseSlow();
  await first;
  const now = hook.render(OTHER);
  assert.equal(now.lesson.title, 'New lesson');
  // State that belongs to another lesson id is never returned (the render after a route change).
  const back = hook.render(LESSON_ID);
  assert.deepEqual([back.status, back.lesson], ['loading', null]);
});

test('Phase 7: a silent refresh keeps the lesson on screen, and a failed one keeps it too', async () => {
  let n = 0;
  const hook = loadHook(() => {
    n += 1;
    if (n === 2) throw new Error('Network Error');
    return { ok: true, status: 200, data: { _id: LESSON_ID, title: `Version ${n}` } };
  });
  await hook.render().refetch();
  await hook.render().refetch({ silent: true });
  const kept = hook.render();
  assert.deepEqual([kept.status, kept.lesson.title], ['ready', 'Version 1']);
  await kept.refetch({ silent: true });
  assert.equal(hook.render().lesson.title, 'Version 3');
});

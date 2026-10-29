/**
 * useLesson loading state (hooks/useLesson.ts).
 *
 * Regression: a lesson that loaded successfully (200), a paywall answer (403) and a missing
 * lesson (404) all returned before `setLoading(false)`, so the lesson page stayed on its skeleton
 * forever. Only a 401 (the API client is redirecting to sign-in) may keep the loading state.
 *
 * The TypeScript hook is transpiled in memory and run with a minimal stand-in for React's hooks
 * and a mocked API client. No browser, network or database is used.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const SOURCE = path.join(__dirname, '..', 'hooks', 'useLesson.ts');

function loadHook(apiResponse) {
  const state = [];
  const fakeReact = {
    useState(initial) {
      const slot = { value: initial };
      state.push(slot);
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
  };
  const fakeApi = {
    apiClient: { getAllowingError: async () => apiResponse() },
    isUnauthorizedError: () => false,
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = new Module(SOURCE);
  mod.filename = SOURCE;
  mod.paths = Module._nodeModulePaths(path.dirname(SOURCE));
  mod.require = (id) => (id === 'react' ? fakeReact : id === '@/lib/api-client' ? fakeApi : require(id));
  mod._compile(outputText, SOURCE);
  return { useLesson: mod.exports.useLesson, state };
}

async function finalState(apiResponse) {
  const { useLesson, state } = loadHook(apiResponse);
  const hook = useLesson('650000000000000000000001', true);
  await hook.refetch();
  // useState order in useLesson: lesson, accessDenied, loading, error.
  const [lesson, accessDenied, loading, error] = state.map((slot) => slot.value);
  return { lesson, accessDenied, loading, error };
}

test('a lesson that loads clears the loading state', async () => {
  const result = await finalState(() => ({ ok: true, status: 200, data: { _id: 'l1', title: 'Intro' } }));
  assert.equal(result.loading, false);
  assert.equal(result.lesson.title, 'Intro');
});

test('a paywall answer clears the loading state and shows the access message', async () => {
  const result = await finalState(() => ({ ok: false, status: 403, data: { access: false, locked: true, message: 'Unlock to continue' } }));
  assert.equal(result.loading, false);
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
});

test('a 401 keeps the loading state while the API client redirects to sign-in', async () => {
  const result = await finalState(() => ({ ok: false, status: 401, data: {} }));
  assert.equal(result.loading, true);
  assert.equal(result.error, null);
});

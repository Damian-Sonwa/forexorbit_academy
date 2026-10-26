const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLoadingPresentation } = require('../lib/loading-presentation');

test('session resolution stays on the full-page treatment', () => {
  assert.equal(resolveLoadingPresentation({ authLoading: true, authorized: null }), 'full-page');
  assert.equal(resolveLoadingPresentation({ authLoading: false, authorized: null }), 'full-page');
});

test('an unresolved role does not fall through to content', () => {
  assert.equal(resolveLoadingPresentation({ authorized: false, dataLoading: true, hasData: true }), 'blocked');
});

test('first data load uses a skeleton and a later load keeps content', () => {
  assert.equal(resolveLoadingPresentation({ authorized: true, dataLoading: true, hasData: false }), 'skeleton');
  assert.equal(resolveLoadingPresentation({ authorized: true, dataLoading: true, hasData: true }), 'refresh');
});

test('a failed request is not treated as an empty result', () => {
  assert.equal(resolveLoadingPresentation({ authorized: true, error: 'Progress could not be loaded.', hasData: false }), 'error');
  assert.equal(resolveLoadingPresentation({ authorized: true, hasData: false }), 'empty');
  assert.equal(resolveLoadingPresentation({ authorized: true, hasData: true }), 'content');
});

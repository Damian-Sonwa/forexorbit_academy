const test = require('node:test');
const assert = require('node:assert/strict');
const { isAbortedRequest } = require('../lib/request-status');

test('a canceled browser request is not a profile or news failure', () => {
  assert.equal(isAbortedRequest({ message: 'Request aborted', code: 'ERR_CANCELED', name: 'CanceledError' }), true);
  assert.equal(isAbortedRequest({ message: 'Request aborted' }), true);
});

test('a real request failure stays visible to the caller', () => {
  assert.equal(isAbortedRequest({ message: 'Request failed with status code 404', code: 'ERR_BAD_REQUEST' }), false);
  assert.equal(isAbortedRequest(null), false);
});

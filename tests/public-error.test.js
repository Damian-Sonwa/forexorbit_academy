const test = require('node:test');
const assert = require('node:assert/strict');
const {
  unexpectedBody,
  clientFacingError,
  looksSensitive,
  messageFromUnknown,
  publicBody,
} = require('../lib/public-error');

test('an unexpected exception becomes a generic client response with a request id', () => {
  const body = unexpectedBody('orders', new Error('MongoServerError: bad auth'));
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.equal(body.error, 'Something went wrong. Please try again later.');
  assert.equal(typeof body.requestId, 'string');
  assert.equal(body.requestId.length > 0, true);
  assert.equal(JSON.stringify(body).includes('Mongo'), false);
  assert.equal(JSON.stringify(body).includes('stack'), false);
});

test('database, token, and connection-string text is not shown to the client', () => {
    const samples = [
      'MongoServerError: connect ECONNREFUSED 10.0.0.5:27017',
      ['mongodb', '+srv://app:secret@cluster.example'].join(''),
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturevalue',
      'Error: fail\n    at handler (C:\\Users\\Juliet\\app\\pages\\api\\login.ts:1:1)',
    ];
  for (const sample of samples) {
    assert.equal(looksSensitive(sample), true);
    const mapped = clientFacingError({ status: 500, error: sample });
    assert.equal(mapped.message.includes('Mongo'), false);
    assert.equal(mapped.message.includes('secret'), false);
    assert.equal(mapped.message.includes('eyJ'), false);
    assert.equal(mapped.message.includes('Users'), false);
  }
});

test('validation, auth, missing, and conflict statuses keep their safe messages', () => {
  assert.equal(clientFacingError({ status: 400, error: 'Email and password required' }).message, 'Email and password required');
  assert.equal(clientFacingError({ status: 401, error: 'Invalid email or password. Please check your credentials.' }).message, 'Invalid email or password. Please check your credentials.');
  assert.equal(clientFacingError({ status: 403, error: 'You are not authorized to perform this action.' }).message, 'You are not authorized to perform this action.');
  assert.equal(clientFacingError({ status: 404, error: 'This item could not be found.' }).message, 'This item could not be found.');
  assert.equal(clientFacingError({ status: 409, error: 'Already enrolled' }).message, 'Already enrolled');
  assert.equal(publicBody('VALIDATION', 'Please check the information you entered.').code, 'VALIDATION');
});

test('an unknown axios failure does not surface the library message', () => {
  const message = messageFromUnknown({
    message: 'Request failed with status code 500',
    response: { status: 500, data: { error: 'E11000 duplicate key error collection users' } },
  });
  assert.equal(message.includes('E11000'), false);
  assert.equal(message.includes('Request failed'), false);
  assert.equal(message, 'Something went wrong. Please try again later.');
});

test('API handlers do not return raw exception text', () => {
  const fs = require('fs');
  const path = require('path');
  const roots = [path.join(__dirname, '..', 'pages', 'api')];
  const offenders = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        if (/error:\s*error\.message/.test(source) || /message:\s*errorMessage/.test(source) || /details:\s*`Missing:/.test(source)) {
          offenders.push(path.relative(path.join(__dirname, '..'), full));
        }
      }
    }
  }
  roots.forEach(walk);
  assert.deepEqual(offenders, []);
});

test('a network failure and a canceled request stay distinct', () => {
  assert.equal(messageFromUnknown({ message: 'Network Error', code: 'ERR_NETWORK' }), 'We could not reach the service. Check your connection and try again.');
  assert.equal(messageFromUnknown({ message: 'Request aborted', code: 'ERR_CANCELED', name: 'CanceledError' }), '');
});

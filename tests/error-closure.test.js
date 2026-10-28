/**
 * Error-handling closure. In-memory only. Synthetic values stay inside assertions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { signupConflict } = require('../lib/signup-conflict');
const { publicUploadFailure, unexpectedBody, clientFacingError, messageFromUnknown } = require('../lib/public-error');
const { decideAccountAccess, decideCommunityRoomJoin } = require('../lib/account-access');

const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('duplicate email and phone signups share one response and do not create an account', () => {
  const email = signupConflict({ id: 'email-row' }, null);
  const phone = signupConflict(null, { id: 'phone-row' });
  const both = signupConflict({ id: 'email-row' }, { id: 'phone-row' });
  assert.equal(email.status, 400);
  assert.deepEqual(email.body, phone.body);
  assert.deepEqual(email.body, both.body);
  assert.equal(email.body.error.includes('User already exists'), false);
  assert.equal(email.body.error.includes('phone number'), false);
  assert.equal(signupConflict(null, null), null);
  const signup = read('pages/api/auth/signup.ts');
  assert.equal(signup.includes('User already exists'), false);
  assert.equal(signup.includes('already registered'), false);
  assert.equal(signup.includes('signupConflict'), true);
  assert.equal(signup.includes('phoneE164'), false);
  assert.equal(signup.includes('parseToE164'), false);
});

test('account recovery responses do not add an existence oracle', () => {
  const forgot = read('pages/api/auth/forgot-password.ts');
  const verify = read('pages/api/auth/verify-password-otp.ts');
  const reset = read('pages/api/auth/reset-password.ts');
  const login = read('pages/api/auth/login.ts');
  const phone = read('pages/api/auth/update-phone.ts');
  assert.equal(forgot.includes('rateLimited'), false);
  assert.equal(forgot.includes('cooldown'), false);
  assert.equal(forgot.includes('Would send OTP'), false);
  assert.equal(verify.includes('This code has expired'), false);
  assert.equal(verify.includes('User not found'), false);
  assert.equal(reset.includes('User not found'), false);
  assert.equal(login.includes('Invalid email or password. Please check your credentials.'), true);
  assert.equal(phone.includes('another account'), false);
});

test('upload and config failures do not return provider secrets or paths', () => {
  const marker = ['cloud', 'name_key'].join('');
  const secret = ['api', '_secret_value'].join('');
  const filePath = ['C:', '\\Users\\', 'example\\', 'upload.tmp'].join('');
  const upstream = ['provider', ' payload ', secret].join('');
  const failure = publicUploadFailure({
    message: 'Cloudinary configuration is missing ' + marker + ' ' + secret + ' ' + filePath + ' ' + upstream,
  });
  const encoded = JSON.stringify(failure.body);
  assert.equal(failure.status, 500);
  assert.equal(failure.body.code, 'UPLOAD_UNAVAILABLE');
  assert.equal(typeof failure.body.requestId, 'string');
  assert.equal(encoded.includes(marker), false);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes('Users'), false);
  assert.equal(encoded.includes('payload'), false);
  const limited = publicUploadFailure({ code: 'LIMIT_FILE_SIZE', message: filePath }, { limitMessage: 'File size exceeds 10MB limit' });
  assert.equal(limited.status, 400);
  assert.equal(limited.body.error, 'File size exceeds 10MB limit');
  assert.equal(JSON.stringify(limited.body).includes('Users'), false);
  const config = read('pages/api/upload/check-config-public.ts');
  assert.equal(config.includes('CLOUDINARY_API_SECRET'), false);
  assert.equal(config.includes('NODE_ENV'), false);
  const sms = read('pages/api/auth/check-email-config.ts');
  assert.equal(sms.includes('TWILIO_'), false);
  assert.equal(sms.includes('TERMII_'), false);
});

test('synthetic database, token, path, and axios text stays out of the client message', () => {
  const samples = [
    ['Mongo', 'ServerError E11000'].join(''),
    ['mongodb', '+srv://app:pw@cluster.example/db'].join(''),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturevalue',
    'Error: fail\n    at handler (C:\\Users\\example\\pages\\api\\login.ts:4:2)',
    'Request failed with status code 500',
  ];
  for (const sample of samples) {
    const mapped = clientFacingError({ status: 500, error: sample });
    assert.equal(mapped.message, 'Something went wrong. Please try again later.');
    assert.equal(mapped.message.includes(sample.slice(0, 8)), false);
  }
  const logs = [];
  const original = console.error;
  console.error = (line) => logs.push(String(line));
  let body;
  try {
    body = unexpectedBody('closure', Object.assign(new Error(samples[1]), { name: 'MongoServerError', code: 'ECONNREFUSED' }));
  } finally {
    console.error = original;
  }
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes('pw@'), false);
  assert.equal(logs[0].includes('MongoServerError'), true);
  assert.equal(logs[0].includes(body.requestId), true);
  const axiosMessage = messageFromUnknown({
    message: 'Request failed with status code 500',
    response: { status: 500, data: samples[1] },
  });
  assert.equal(axiosMessage, 'Something went wrong. Please try again later.');
});

test('socket authentication and room denial stay generic', () => {
  const missing = decideAccountAccess({ userId: '', record: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 401);
  assert.equal(missing.error, 'Authentication required');
  const inactive = decideAccountAccess({
    userId: 'student-1',
    record: { role: 'student', status: 'suspended', email: 'person@example.com' },
  });
  assert.equal(inactive.ok, false);
  assert.equal(inactive.status, 403);
  assert.equal(inactive.error, 'Account is not active');
  assert.equal(JSON.stringify(inactive).includes('@'), false);
  const lookup = decideCommunityRoomJoin({
    user: { userId: 'student-1', role: 'student' },
    roomId: 'room-1',
    lookupError: true,
  });
  assert.equal(lookup.ok, false);
  assert.equal(lookup.error, 'Unable to join room');
  const denied = decideCommunityRoomJoin({
    user: { userId: 'student-1', role: 'student' },
    roomId: 'room-1',
    room: { _id: 'room-1', name: 'Private', type: 'private', participants: [] },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'Access denied');
  const server = read('server.js');
  assert.equal(server.includes("next(new Error('Authentication error'))"), true);
  assert.equal(server.includes('next(error)'), false);
  assert.equal(server.includes('User connected:'), false);
  assert.equal(server.includes('AI_API_KEY.substring'), false);
  assert.equal(server.includes("socket.emit('error', { message: 'Failed to join consultation' })"), true);
});

test('API catch blocks no longer return a fixed internal error without a request id helper', () => {
  const offenders = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        if (/error:\s*'Internal server error'/.test(source) || /error:\s*'Failed to (process request|reset password|verify code|update phone|upload file|check reminders)'/.test(source)) {
          offenders.push(path.relative(root, full));
        }
      }
    }
  }
  walk(path.join(root, 'pages', 'api'));
  assert.deepEqual(offenders, []);
  const client = read('lib/api-client.ts');
  assert.equal(client.includes("typeof data === 'string'"), true);
  const call = read('components/AgoraCall.tsx');
  assert.equal(call.includes('err.message ||'), false);
});

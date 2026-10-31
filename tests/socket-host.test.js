/**
 * Socket and API origins. No network connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveSocketUrl, resolveApiBaseUrl } = require('../lib/client-origin');

const PRODUCTION_HOST = 'forexorbit-academy.onrender.com';

test('an unset socket URL stays on the page origin', () => {
  const local = resolveSocketUrl(undefined, 'http://localhost:3000');
  const preview = resolveSocketUrl('  ', 'https://forexorbit-academy-git-preview.vercel.app/');
  assert.equal(local, 'http://localhost:3000');
  assert.equal(preview, 'https://forexorbit-academy-git-preview.vercel.app');
  assert.equal(local.includes(PRODUCTION_HOST), false);
  assert.equal(preview.includes(PRODUCTION_HOST), false);
});

test('an explicit socket URL is used only when this build sets one', () => {
  const configured = resolveSocketUrl('https://preview.example.test/', 'http://localhost:3000');
  assert.equal(configured, 'https://preview.example.test');
});

test('an unset API base does not select a remote host', () => {
  assert.equal(resolveApiBaseUrl(undefined), '');
  assert.equal(resolveApiBaseUrl('https://api.preview.example.test/'), 'https://api.preview.example.test');
});

test('client entry points do not hard-code the production socket host', () => {
  const files = [
    'hooks/useSocket.ts',
    'lib/api-client.ts',
    'lib/ai-client.ts',
    'components/AIAssistant.tsx',
    'pages/consultations/chat/[sessionId].tsx',
  ];
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    assert.equal(source.includes(PRODUCTION_HOST), false, relativePath);
    assert.equal(source.includes('localStorage'), false, relativePath);
  }
  // The socket connects to the page's own origin, where the host-only session cookie is sent.
  const socket = fs.readFileSync(path.join(__dirname, '..', 'hooks/useSocket.ts'), 'utf8');
  assert.equal(socket.includes('auth: { token }'), false);
  assert.equal(socket.includes('const socketUrl = window.location.origin;'), true);
});

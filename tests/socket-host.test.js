/**
 * Single canonical origin: the browser reaches the API and Socket.IO on its own origin.
 * Source checks only; no network connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** Every file bundled for the browser: pages (not API routes), components, hooks and client libraries. */
function browserFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (rel !== 'pages/api') walk(rel);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(rel);
    }
  };
  for (const dir of ['pages', 'components', 'hooks', 'contexts']) if (fs.existsSync(path.join(ROOT, dir))) walk(dir);
  return out;
}

/** Variables the browser may read: public identifiers and feature switches only. */
const BROWSER_VARIABLES = new Set([
  'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY',
  'NEXT_PUBLIC_ADS_ENABLED',
  'NEXT_PUBLIC_ADS_PROVIDER',
  'NEXT_PUBLIC_ADSENSE_CLIENT',
  'NEXT_PUBLIC_ADSENSE_BANNER_SLOT',
  'NEXT_PUBLIC_ADMOB_WEB_BANNER_SLOT',
  'NEXT_PUBLIC_PROPELLERADS_WIDGET_SCRIPT_URL',
  'NEXT_PUBLIC_PROPELLERADS_LIBRARY_SCRIPT_URL',
  'NEXT_PUBLIC_PROPELLERADS_ZONE_ID',
  'NEXT_PUBLIC_BROKER_API_ENABLED',
  'NEXT_PUBLIC_PHONE_DEFAULT_REGION',
]);
const isBrowserVariable = (name) => BROWSER_VARIABLES.has(name) || /^NEXT_PUBLIC_PROP_PLACEMENT_[A-Z_]+$/.test(name);

test('the API client and every hand-written call use same-origin relative URLs', () => {
  assert.match(read('lib/api-client.ts'), /const API_URL = '\/api';/);
  assert.doesNotMatch(read('lib/ai-client.ts'), /baseURL/);
  assert.match(read('components/AIAssistant.tsx'), /apiFetch\('\/api\/ai\/check-config'/);
  assert.match(read('components/AIAssistant.tsx'), /apiFetch\('\/api\/ai\/answer-question'/);
  assert.match(read('pages/consultations/chat/[sessionId].tsx'), /const tokenUrl = `\/api\/consultations\/agora-token\?channel=/);
  assert.equal(fs.existsSync(path.join(ROOT, 'lib/client-origin.js')), false, 'no configurable backend origin');
});

test('the socket connects to the page origin, where the host-only session cookie is sent', () => {
  const socket = read('hooks/useSocket.ts');
  assert.equal(socket.includes('const socketUrl = window.location.origin;'), true);
  assert.equal(socket.includes('auth: { token }'), false);
});

test('browser code reads no API or socket host variable and names no deployment host', () => {
  const files = [...browserFiles(), 'lib/api-client.ts', 'lib/ai-client.ts', 'lib/api-fetch.ts'];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /NEXT_PUBLIC_(API_BASE_URL|API_URL|SOCKET_URL)/, file);
    assert.doesNotMatch(source, /[a-z0-9-]+\.(vercel\.app|onrender\.com)/i, file);
  }
});

test('browser code reads only public NEXT_PUBLIC_ variables and never a server secret', () => {
  // Client libraries that read NEXT_PUBLIC_ variables (lib/lesson-monetization.ts is server-only: pages/api).
  const libraries = ['lib/ads-config.ts', 'lib/propeller-ads-placements.ts', 'lib/phone.ts'];
  for (const file of [...browserFiles(), ...libraries]) {
    const source = read(file);
    for (const [name] of source.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
      assert.ok(isBrowserVariable(name), `${file} reads ${name}, which is not on the browser list`);
    }
    assert.doesNotMatch(source, /process\.env\.(PAYSTACK_SECRET_KEY|JWT_SECRET|MONGO_URI|MONGODB_URI|RESEND_API_KEY|CLOUDINARY_API_SECRET|CLOUDINARY_API_KEY|AGORA_APP_CERTIFICATE|AI_API_KEY|OANDA_API_KEY|APP_ORIGIN)\b/, file);
  }
  // Next.js inlines only NEXT_PUBLIC_ names, and next.config.js must not copy others into the bundle.
  assert.doesNotMatch(read('next.config.js'), /^\s*env\s*:/m);
});

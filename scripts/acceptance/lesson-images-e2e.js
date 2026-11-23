/**
 * Lesson images acceptance run: the REAL application in headless Microsoft Edge against an isolated
 * test database, with NO storage service configured (no R2, no Cloudinary), so every image goes to
 * the built-in database storage (lib/course-image-store.js). Checks that an instructor can paste,
 * drop or pick an image inside the lesson text, that the text is split at the cursor around a new
 * image block, that large images are shrunk in the browser before upload, that the images survive
 * a reload, and that students see them. Same safety rules as course-builder-e2e.js (guard.js).
 *
 *   ACCEPTANCE_MONGODB_URI=mongodb://127.0.0.1:27099/?replicaSet=rs15 \
 *   ACCEPTANCE_DB_NAME=forexorbit_images_acceptance \
 *   node scripts/acceptance/lesson-images-e2e.js [--reset] [--port 3330] [--shots <dir>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { MongoClient, ObjectId } = require('mongodb');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION, shieldLocalEnv } = require('./guard');
const { launchBrowser, sleep } = require('./browser');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(option('--port', '3330'));
const BASE = `http://localhost:${PORT}`;
const SHOTS = option('--shots', fs.mkdtempSync(path.join(os.tmpdir(), 'fo-images-shots-')));
const ASSETS = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-images-assets-'));
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(role, check, ok, detail = '') {
  results.push({ role, check, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${role}] ${check}${detail ? ` (${detail})` : ''}`);
}

const ACCOUNTS = { instructor: 'instructor', admin: 'admin', student: 'student' };

async function seed(db) {
  const disposable = await checkDisposable(db);
  if (!disposable.ok) throw new Error(disposable.reason);
  if (!disposable.fresh) {
    if (!args.includes('--reset')) throw new Error('The acceptance database has fixtures from an earlier run; pass --reset.');
    for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (name !== MARKER_COLLECTION && !name.startsWith('system.')) await db.collection(name).deleteMany({});
    }
  }
  await db.collection(MARKER_COLLECTION).updateOne({ _id: MARKER._id }, { $set: { kind: MARKER.kind, seededAt: new Date() } }, { upsert: true });
  const bcrypt = require('bcryptjs');
  const accounts = {};
  for (const [key, role] of Object.entries(ACCOUNTS)) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `images-${key}@acceptance.invalid`;
    const res = await db.collection('users').insertOne({ name: `Builder ${key}`, email, password: await bcrypt.hash(password, 10), role, status: 'approved', sessionGeneration: 0, createdAt: new Date() });
    accounts[key] = { id: String(res.insertedId), email, password };
  }
  return accounts;
}

function startApp(uri, dbName, logFile) {
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(PORT), MONGO_URI: uri, MONGODB_DB_NAME: dbName,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false',
    COURSE_ASSETS_LOCAL_DIR: ASSETS,
  };
  const out = fs.openSync(logFile, 'w');
  return spawn(process.execPath, ['server.js'], { cwd: ROOT, env: shieldLocalEnv(env), stdio: ['ignore', out, out] });
}

async function waitForServer(logFile, timeoutMs = 300000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    if (/Server is ready|ready on|Ready/i.test(log)) {
      try { const res = await fetch(`${BASE}/api/courses`); if (res.status < 500) return true; } catch { /* not yet */ }
    }
    await sleep(1000);
  }
  return false;
}

async function main() {
  const config = checkAcceptanceConfig(process.env);
  if (!config.ok) throw new Error(config.reason);
  const client = new MongoClient(config.uri);
  await client.connect();
  const db = client.db(config.dbName);
  const accounts = await seed(db);
  const logFile = path.join(os.tmpdir(), `fo-images-server-${PORT}.log`);
  const app = startApp(config.uri, config.dbName, logFile);
  let browser;
  try {
    record('setup', 'application started', await waitForServer(logFile));
    browser = await launchBrowser(9351, 'images');
    const t = browser.first;
    const { evaluate, waitFor, send } = t;
    await send('DOM.enable');
    t.on('Page.javascriptDialogOpening', (p) => { void send('Page.handleJavaScriptDialog', { accept: true, promptText: p.type === 'prompt' ? (p.defaultPrompt || '') : undefined }); });
    const errors = [];
    t.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails && p.exceptionDetails.text));
    await send('Runtime.enable');

    const width = async (w, h = 900) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    const goto = async (url) => { await send('Page.navigate', { url: `${BASE}${url}` }); await sleep(400); await waitFor('document.readyState === "complete"', 60000); };
    const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); if (r.data) fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64')); };
    const noOverflow = async () => evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1');
    const js = (s) => JSON.stringify(s);
    const click = (selector) => evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; el.click(); return true; })()`);
    const clickText = (selector, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${js(selector)})].find((e) => e.textContent.trim().includes(${js(text)})); if (!el) return false; el.click(); return true; })()`);
    // React-controlled inputs need the native setter plus an input event.
    const fill = (selector, value, index = 0) => evaluate(`(() => { const el = document.querySelectorAll(${js(selector)})[${index}]; if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
    const typeInto = async (selector, text, index = 0) => {
      const ok = await evaluate(`(() => { const el = document.querySelectorAll(${js(selector)})[${index}]; if (!el) return false; el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
      if (ok) await send('Input.insertText', { text });
      return ok;
    };
    const login = async (who) => {
      await goto('/login');
      return evaluate(`fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify({ email: ${js(accounts[who].email)}, password: ${js(accounts[who].password)} }) }).then((r) => r.status)`);
    };
    const logout = () => evaluate(`fetch('/api/auth/logout', { method: 'POST', headers: { 'X-FO-CSRF': '1' } }).then((r) => r.status)`);
    const saved = () => waitFor(`(() => { const s = [...document.querySelectorAll('[data-testid="save-status"]')]; return s.length > 0 && s.every((x) => x.dataset.status === 'saved'); })()`, 30000);
    const signature = () => evaluate(`(() => { const root = document.querySelector('[data-testid="lesson-blocks"]'); if (!root) return null; return [...root.children].map((c) => c.dataset.block + ':' + c.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80)).join(' | '); })()`);

    await width(1280);
    await width(1280);
    const blockTypes = () => evaluate('[...document.querySelectorAll("[data-testid=block-editor]")].map((b) => b.dataset.blockType).join(",")');
    const imageSrcs = () => evaluate('[...document.querySelectorAll("[data-block-type=image] img")].map((i) => i.getAttribute("src"))');
    const texts = () => evaluate('[...document.querySelectorAll("[data-block-type=text] .ql-editor")].map((e) => e.innerText.trim())');
    // A large, noisy PNG made in the page (3000 x 2000), so resizing has something to do.
    const makeImage = (name, w = 3000, h = 2000) => `(async () => {
      const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
      const x = c.getContext('2d'); const d = x.createImageData(${w}, ${h});
      for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (i * 7) % 255; d.data[i + 1] = (i * 13) % 251; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      window.__lastImageBytes = blob.size;
      return new File([blob], ${js(name)}, { type: 'image/png' });
    })()`;

    // ------------------------------------------------------------------ instructor
    record('instructor', 'signs in', (await login('instructor')) === 200);
    await goto('/builder/new');
    await waitFor('!!document.querySelector("[data-testid=new-course-title]")', 90000);
    await fill('[data-testid=new-course-title]', 'Reading charts');
    await click('[data-testid=create-course]');
    await waitFor('/\\/builder\\/[a-f0-9]{24}/.test(location.pathname) && !!document.querySelector("[data-testid=builder-title]")', 90000);
    const courseId = await evaluate('location.pathname.split("/")[2]');
    await click('[data-testid=first-lesson]');
    record('instructor', 'opens a lesson', await waitFor('!!document.querySelector("[data-testid=lesson-editor]")', 30000));
    await fill('[data-testid=lesson-title]', 'Support and resistance');
    const addBlock = async (type) => { await click('[data-testid=add-block]'); await sleep(150); return click(`[data-testid=add-${type}]`); };
    await addBlock('text');
    await waitFor('!!document.querySelector(".builder-quill .ql-editor")', 30000);
    await typeInto('.builder-quill .ql-editor', 'Price often turns at the same level. Look at the chart below. That level is support.');
    record('instructor', 'the text toolbar has an image button', await waitFor('!!document.querySelector("[data-block-type=text] .ql-toolbar .ql-image")', 10000));

    // 1. Paste an image with the cursor after "below." -> text, image, text.
    const cut = 'Price often turns at the same level. Look at the chart below.'.length;
    const pasted = await evaluate(`(async () => {
      const editor = document.querySelector('[data-block-type=text] .ql-editor');
      const quill = editor.parentElement.__quill;
      quill.setSelection(${cut}, 0);
      const file = await ${makeImage('support-chart.png')};
      const dt = new DataTransfer(); dt.items.add(file);
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return window.__lastImageBytes;
    })()`);
    await waitFor('document.querySelectorAll("[data-block-type=image] img").length === 1', 60000);
    const afterPaste = await blockTypes();
    record('instructor', 'pasting an image splits the text at the cursor around a new image block', afterPaste === 'text,image,text', afterPaste);
    const parts = await texts();
    record('instructor', 'the text before and after the image is kept', parts[0] === 'Price often turns at the same level. Look at the chart below.' && parts[1] === 'That level is support.', JSON.stringify(parts));
    const [src1] = await imageSrcs();
    record('instructor', 'the image is stored in the app (no storage service configured)', /^\/api\/course-images\/[a-f0-9]{32}\.(webp|jpg)$/.test(String(src1)), src1);
    const alt = await evaluate('document.querySelector("[data-block-type=image] input[maxlength=\\"300\\"]").value');
    record('instructor', 'the screen-reader description starts from the file name', alt === 'support chart', alt);
    const stored = await db.collection('courseImages').findOne({ _id: String(src1).split('/').pop().replace(/\.\w+$/, '') });
    record('instructor', 'the browser shrank the image before upload', Boolean(stored && stored.size * 4 < pasted), `${pasted} -> ${stored && stored.size} bytes, ${stored && stored.mime}`);
    const served = await evaluate(`fetch(${js(src1)}).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control') }))`);
    record('instructor', 'the stored image is served with a long cache', served.status === 200 && /^image\//.test(served.type) && /immutable/.test(served.cache), JSON.stringify(served));
    const dims = await evaluate('(() => { const i = document.querySelector("[data-block-type=image] img"); return i.decode().then(() => [i.naturalWidth, i.naturalHeight], () => null); })()');
    record('instructor', 'the shrunk image is at most 1920 px wide', Array.isArray(dims) && dims[0] > 0 && dims[0] <= 1920, JSON.stringify(dims));

    // 2. Drop an image at the end of the last text block -> text, image, text, image.
    await evaluate(`(async () => {
      const editors = document.querySelectorAll('[data-block-type=text] .ql-editor');
      const editor = editors[editors.length - 1];
      const quill = editor.parentElement.__quill;
      quill.setSelection(quill.getLength() - 1, 0);
      const file = await ${makeImage('resistance.png', 800, 500)};
      const dt = new DataTransfer(); dt.items.add(file);
      editor.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })()`);
    await waitFor('document.querySelectorAll("[data-block-type=image] img").length === 2', 60000);
    const afterDrop = await blockTypes();
    record('instructor', 'dropping an image at the end of the text adds it after the text', afterDrop === 'text,image,text,image', afterDrop);

    // 3. The toolbar button asks for an image file; the image goes where the cursor is. The file
    //    input the button opens is captured and given a file directly (headless file-chooser
    //    events are unreliable), which still runs the real button, handler and placement.
    const chosen = path.join(ASSETS, '..', `fo-pick-${Date.now()}.png`);
    const smallPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBkYGBgYAAAeAAP+5a1ZWQAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(chosen, smallPng);
    await evaluate(`(() => { window.__pickerInput = null; const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file' && !this.isConnected) { window.__pickerInput = this; return undefined; } return orig.call(this); }; })()`);
    await evaluate(`(() => { const editor = document.querySelector('[data-block-type=text] .ql-editor'); editor.parentElement.__quill.setSelection(6, 0); document.querySelector('[data-block-type=text] .ql-toolbar .ql-image').click(); })()`);
    const asked = await waitFor('!!window.__pickerInput && window.__pickerInput.accept.includes("image/png")', 10000);
    record('instructor', 'the toolbar image button asks for an image file', asked);
    if (asked) {
      await evaluate(`(() => {
        const bytes = Uint8Array.from(atob(${js(smallPng.toString('base64'))}), (c) => c.charCodeAt(0));
        const dt = new DataTransfer(); dt.items.add(new File([bytes], 'picked.png', { type: 'image/png' }));
        window.__pickerInput.files = dt.files;
        window.__pickerInput.dispatchEvent(new Event('change'));
      })()`);
    }
    await waitFor('document.querySelectorAll("[data-block-type=image] img").length === 3', 60000);
    const afterPick = await blockTypes();
    record('instructor', 'a picked image goes where the cursor is', afterPick === 'text,image,text,image,text,image' && (await texts())[0] === 'Price', `${afterPick} ${JSON.stringify(await texts())}`);

    // 4. An iPhone HEIC photo gets a clear message instead of a failed upload.
    await addBlock('image');
    const docNode = await send('DOM.getDocument', { depth: -1, pierce: true });
    const inputs = await send('DOM.querySelectorAll', { nodeId: docNode.root.nodeId, selector: '[data-block-type=image] input[type=file]' });
    const heic = path.join(ASSETS, '..', `fo-photo-${Date.now()}.heic`);
    fs.writeFileSync(heic, Buffer.alloc(64));
    await send('DOM.setFileInputFiles', { files: [heic], nodeId: inputs.nodeIds[inputs.nodeIds.length - 1] });
    record('instructor', 'a HEIC photo gets a clear message', await waitFor('document.body.innerText.includes("HEIC photos")', 10000));
    // Remove the empty image block again.
    await evaluate(`(() => { const blocks = document.querySelectorAll('[data-testid=block-editor]'); const del = blocks[blocks.length - 1].querySelector('button[aria-label="Delete block"]'); if (del) del.click(); })()`);
    await sleep(300);

    record('instructor', 'autosaves the lesson', await saved());
    const lesson = await db.collection('lessons').findOne({ courseId });
    const storedTypes = (lesson && lesson.blocks || []).map((b) => b.type).join(',');
    record('instructor', 'the saved lesson keeps text and images in order', storedTypes.startsWith('text,image,text,image,text,image'), storedTypes);
    await shot('builder-images-1280');

    // 5. After a reload the images are still there.
    await goto(`/builder/${courseId}`);
    await waitFor('!!document.querySelector("[data-testid=lesson-editor]")', 60000);
    await waitFor('document.querySelectorAll("[data-block-type=image] img").length >= 3', 30000);
    const loaded = await evaluate('Promise.all([...document.querySelectorAll("[data-block-type=image] img")].map((i) => i.decode().then(() => i.naturalWidth > 0, () => false)))');
    record('instructor', 'the images load again after a reload', loaded.length >= 3 && loaded.every(Boolean), JSON.stringify(loaded));

    // 6. The student preview shows them, and the page fits a phone.
    await click('[data-testid=view-preview]');
    await waitFor('!!document.querySelector("[data-testid=lesson-blocks]")', 30000);
    const preview = await evaluate('Promise.all([...document.querySelectorAll("[data-testid=lesson-blocks] img")].map((i) => i.decode().then(() => i.naturalWidth > 0, () => false)))');
    record('instructor', 'the student preview shows the images', preview.length >= 3 && preview.every(Boolean), JSON.stringify(preview));
    await width(390);
    await sleep(400);
    record('instructor', 'the preview fits a phone (390 px)', await noOverflow());
    await shot('preview-images-390');
    await width(1280);

    // 7. Students cannot upload images.
    await logout();
    await login('student');
    const studentUpload = await evaluate(`(async () => { const f = new FormData(); f.append('image', new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }), 'x.png'); const r = await fetch('/api/upload/instructor', { method: 'POST', body: f, headers: { 'X-FO-CSRF': '1' } }); return r.status; })()`);
    record('student', 'cannot upload images', studentUpload === 403 || studentUpload === 401, `status ${studentUpload}`);
    record('all', 'no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    if (browser) await browser.quit();
    app.kill();
    await client.close();
    fs.rmSync(ASSETS, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err && err.message ? err.message : err); process.exit(1); });

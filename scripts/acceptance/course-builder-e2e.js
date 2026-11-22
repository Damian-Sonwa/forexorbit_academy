/**
 * Course builder acceptance run: the REAL application in headless Microsoft Edge against an
 * isolated test database, following an instructor, an administrator and a student through the
 * whole lifecycle. Same safety rules as scripts/acceptance/run.js (guard.js): a local test server,
 * a database ending in "_acceptance" or "_test", synthetic accounts only, no provider keys (course
 * files are stored in a temporary local folder, never in the production storage account).
 *
 *   ACCEPTANCE_MONGODB_URI=mongodb://127.0.0.1:27099/?replicaSet=rs15 \
 *   ACCEPTANCE_DB_NAME=forexorbit_builder_acceptance \
 *   node scripts/acceptance/course-builder-e2e.js [--reset] [--port 3320] [--shots <dir>]
 *
 * Prints one line per check, saves screenshots (desktop 1280 px and phone 390 px), and exits
 * non-zero if any check fails.
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
const PORT = Number(option('--port', '3320'));
const BASE = `http://localhost:${PORT}`;
const SHOTS = option('--shots', fs.mkdtempSync(path.join(os.tmpdir(), 'fo-builder-shots-')));
const ASSETS = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-builder-assets-'));
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
    const email = `builder-${key}@acceptance.invalid`;
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
  const logFile = path.join(os.tmpdir(), `fo-builder-server-${PORT}.log`);
  const app = startApp(config.uri, config.dbName, logFile);
  let browser;
  try {
    record('setup', 'application started', await waitForServer(logFile));
    browser = await launchBrowser(9341, 'builder');
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

    // ------------------------------------------------------------------ instructor
    record('instructor', 'signs in', (await login('instructor')) === 200);
    await goto('/builder/new');
    record('instructor', 'new-course page', await waitFor('!!document.querySelector("[data-testid=new-course-title]")', 60000));
    await fill('[data-testid=new-course-title]', 'Risk management essentials');
    await click('[data-testid=create-course]');
    const opened = await waitFor('/\\/builder\\/[a-f0-9]{24}/.test(location.pathname) && !!document.querySelector("[data-testid=builder-title]")', 90000);
    const courseId = await evaluate('location.pathname.split("/")[2]');
    record('instructor', 'creates a draft course from a title and lands in the builder', opened, courseId);
    record('instructor', 'status shows Draft', (await evaluate('document.querySelector("[data-testid=builder-status]").textContent')) === 'Draft');

    await click('[data-testid=first-lesson]');
    record('instructor', 'adds the first lesson', await waitFor('!!document.querySelector("[data-testid=lesson-editor]")', 30000));
    await click('[data-testid=add-module]');
    record('instructor', 'adds a second module', await waitFor('document.querySelectorAll("[data-testid=curriculum-module]").length === 2', 20000));
    // Rename module 2.
    await evaluate(`[...document.querySelectorAll('[aria-label^="Module actions"]')][1].click()`);
    await clickText('[role=menuitem]', 'Rename');
    await sleep(200);
    await fill('input[aria-label="Module title"]', 'Position sizing');
    await evaluate(`document.querySelector('input[aria-label="Module title"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    record('instructor', 'renames a module', await waitFor('[...document.querySelectorAll("[data-testid=curriculum-module]")][1].innerText.includes("Position sizing")', 20000));
    const idle = () => waitFor('[...document.querySelectorAll("[data-testid=add-lesson]")].every((b) => !b.disabled)', 30000);
    await idle();
    await evaluate(`document.querySelectorAll('[data-testid=add-lesson]')[1].click()`);
    await waitFor('document.querySelectorAll("[data-testid=curriculum-lesson]").length === 2', 30000);
    await idle();
    await evaluate(`document.querySelectorAll('[data-testid=add-lesson]')[0].click()`);
    record('instructor', 'creates multiple lessons in modules', await waitFor('document.querySelectorAll("[data-testid=curriculum-lesson]").length === 3', 30000));

    // Lesson 1 content: select the first lesson.
    await evaluate(`document.querySelector('[data-testid=curriculum-lesson] button').click()`);
    await waitFor('!!document.querySelector("[data-testid=lesson-title]")');
    await fill('[data-testid=lesson-title]', 'Why risk matters');
    const addBlock = async (type) => { await click('[data-testid=add-block]'); await sleep(150); return click(`[data-testid=add-${type}]`); };
    await addBlock('heading');
    await fill('input[aria-label="Heading text"]', 'Protect your capital');
    await addBlock('text');
    await waitFor('document.querySelectorAll(".builder-quill .ql-editor").length >= 1', 30000);
    await typeInto('.builder-quill .ql-editor', 'Most new traders fail because they risk too much on one idea. Keep each loss small.');
    await addBlock('callout');
    await fill('input[aria-label="Callout title"]', 'Rule of thumb');
    await fill('textarea[aria-label="Callout text"]', 'Risk at most 1% of the account on a single trade.');
    await addBlock('video');
    await clickText('[role=tab]', 'Link');
    await fill('input[placeholder="https://"]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await addBlock('file');
    const pdf = path.join(ASSETS, '..', `fo-plan-${Date.now()}.pdf`);
    fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const docNode = await send('DOM.getDocument', { depth: -1, pierce: true });
    const inputs = await send('DOM.querySelectorAll', { nodeId: docNode.root.nodeId, selector: '[data-block-type=file] input[type=file]' });
    await send('DOM.setFileInputFiles', { files: [pdf], nodeId: inputs.nodeIds[inputs.nodeIds.length - 1] });
    record('instructor', 'uploads a PDF learning resource with progress and private storage', await waitFor('document.body.innerText.includes("stored privately")', 60000));
    await fill('[data-block-type=file] input[maxlength="200"]', 'Trading plan template');
    // An image by link (no upload provider needed).
    await addBlock('image');
    await evaluate(`[...document.querySelectorAll('[data-block-type=image] [role=tab]')].find((t) => t.textContent.trim() === 'Link').click()`);
    await waitFor('!!document.querySelector("[data-testid=image-link]")', 10000);
    await fill('[data-testid=image-link]', `${BASE}/favicon.ico`);
    await fill('[data-block-type=image] input[maxlength="300"]', 'Site icon');
    record('instructor', 'adds an image by link without any upload provider', await waitFor('!!document.querySelector("[data-block-type=image] img")', 10000));
    record('instructor', 'autosaves the lesson', await saved());
    const typesNow = await evaluate('[...document.querySelectorAll("[data-testid=block-editor]")].map((b) => b.dataset.blockType).join(",")');
    const saveNow = await evaluate('[...document.querySelectorAll("[data-testid=save-status]")].map((x) => x.dataset.status + ":" + x.textContent).join(" ") + " | " + ([...document.querySelectorAll("[role=alert]")].map((x) => x.textContent).join(" / "))');
    record('instructor', 'block types in the editor', typesNow === 'heading,text,callout,video,file,image', `${typesNow} || ${saveNow}`);

    // Other lessons need content before review.
    for (const [i, title, body] of [[1, 'Placing the stop', 'Put the stop beyond the level that proves the idea wrong.'], [2, 'Fixed fractional sizing', 'Position size = account risk / stop distance.']]) {
      await evaluate(`[...document.querySelectorAll('[data-testid=curriculum-lesson]')][${i}].querySelector('button').click()`);
      await sleep(500);
      await fill('[data-testid=lesson-title]', title);
      await addBlock('text');
      await waitFor('document.querySelectorAll(".builder-quill .ql-editor").length >= 1', 30000);
      await typeInto('.builder-quill .ql-editor', body);
      await saved();
    }

    // Persistence: reload and reopen the first lesson.
    await goto(`/builder/${courseId}`);
    await waitFor('!!document.querySelector("[data-testid=lesson-editor]")', 60000);
    const persisted = await evaluate('({ title: document.querySelector("[data-testid=lesson-title]").value, blocks: document.querySelectorAll("[data-testid=block-editor]").length })');
    record('instructor', 'reopened draft keeps the title and every block', persisted.title === 'Why risk matters' && persisted.blocks === 6, JSON.stringify(persisted));

    // Reorder: move the first lesson down; the database order follows.
    const titles = () => evaluate('[...document.querySelectorAll("[data-testid=curriculum-lesson]")].map((l) => l.innerText.split("\\n").find((x) => x.length > 3)).join(" / ")');
    const beforeOrder = await titles();
    await evaluate(`document.querySelector('[aria-label="Move Why risk matters down"]').click()`);
    await sleep(1500);
    const afterOrder = await titles();
    const dbOrder = (await db.collection('lessons').find({ courseId }).sort({ order: 1 }).toArray()).map((l) => l.title);
    record('instructor', 'reorders lessons and the order persists', beforeOrder !== afterOrder && dbOrder[1] === 'Why risk matters', `${afterOrder} | db: ${dbOrder.join(' / ')}`);

    // Student preview inside the builder (unsaved state, real renderer).
    await evaluate(`[...document.querySelectorAll('[data-testid=curriculum-lesson]')].find((l) => l.innerText.includes('Why risk matters')).querySelector('button').click()`);
    await sleep(500);
    await click('[data-testid=view-preview]');
    await waitFor('!!document.querySelector("[data-testid=lesson-preview] [data-testid=lesson-blocks]")', 30000);
    const previewSig = await signature();
    record('instructor', 'student preview renders through the student components with a preview banner', Boolean(previewSig) && (await evaluate('!!document.querySelector("[data-testid=preview-banner]")')), previewSig);
    await shot('builder-preview-1280');
    await width(390);
    await sleep(500);
    record('instructor', 'builder preview fits a phone (390 px)', await noOverflow());
    await shot('builder-preview-390');
    await click('[data-testid=view-edit]');
    await sleep(400);
    record('instructor', 'builder editor fits a phone (390 px)', await noOverflow());
    await shot('builder-edit-390');
    await width(1280);
    await shot('builder-edit-1280');

    // Course preview page (saved course, landing + lesson).
    await goto(`/builder/${courseId}/preview`);
    record('instructor', 'course preview landing shows modules', await waitFor('document.querySelectorAll("[data-testid=course-module]").length === 2', 30000));

    // Details, then readiness and submit for review.
    await goto(`/builder/${courseId}?tab=details`);
    await waitFor('!!document.querySelector("[data-testid=details-panel]")', 30000);
    await fill('[data-testid=course-summary]', 'Size every trade from a fixed risk and protect your account.');
    await fill('[data-testid=course-category]', 'risk');
    await fill('[data-testid=course-difficulty]', 'beginner');
    await fill('input[aria-label="Objective 1"]', 'Size a position from a fixed risk per trade');
    await waitFor('document.querySelectorAll("[data-testid=details-panel] .ql-editor").length > 0', 20000);
    await typeInto('[data-testid=details-panel] .ql-editor', 'A short, practical course on keeping losses small.');
    record('instructor', 'course details autosave', await saved());
    await goto(`/builder/${courseId}?tab=publish`);
    await waitFor('!!document.querySelector("[data-testid=readiness-summary]")', 30000);
    const readiness = await evaluate('document.querySelector("[data-testid=readiness-summary]").textContent');
    record('instructor', 'readiness check passes once required content exists', /Ready/.test(readiness), readiness);
    record('instructor', 'instructor has no Publish action', !(await evaluate('!!document.querySelector("[data-testid=transition-published]")')));
    await click('[data-testid=transition-in_review]');
    record('instructor', 'submits for review', await waitFor('document.querySelector("[data-testid=builder-status]").textContent === "In review"', 30000));
    await goto(`/builder/${courseId}`);
    await waitFor('!!document.querySelector("[data-testid=lesson-title]")', 30000);
    record('instructor', 'content is read-only while in review', await evaluate('document.querySelector("[data-testid=lesson-title]").readOnly === true'));
    // Older content can hold HTML in descriptions and titles; course management shows text only.
    const extraLesson = await db.collection('lessons').insertOne({ courseId, title: '<p>Legacy <strong>HTML</strong> title</p>', order: 99, revision: 0, description: '<p>Old body</p>' });
    await db.collection('courses').updateOne({ _id: new ObjectId(courseId) }, { $set: { description: '<p>A <strong>rich</strong> description</p>' } });
    await goto('/instructor/dashboard');
    await waitFor('document.body.innerText.includes("Risk management essentials")', 60000);
    const dashText = await evaluate('document.body.innerText');
    record('instructor', 'dashboard shows course descriptions without HTML tags', dashText.includes('A rich description') && !/<\/?(p|strong)>/.test(dashText));
    await goto(`/builder/${courseId}`);
    await waitFor('!!document.querySelector("[data-testid=curriculum]")', 60000);
    const builderText = await evaluate('document.querySelector("[data-testid=curriculum]").innerText');
    record('instructor', 'builder shows older HTML titles as plain text', builderText.includes('Legacy HTML title') && !/<\/?(p|strong)>/.test(builderText));
    await db.collection('lessons').deleteOne({ _id: extraLesson.insertedId });
    await logout();

    // ------------------------------------------------------------------ admin
    record('admin', 'signs in', (await login('admin')) === 200);
    await goto('/admin/courses');
    record('admin', 'course list links to the builder', await waitFor(`!!document.querySelector('a[href="/builder/${courseId}"]')`, 60000));
    await goto(`/builder/${courseId}?tab=publish`);
    await waitFor('!!document.querySelector("[data-testid=transition-published]")', 30000);
    record('admin', 'an ordinary admin is not offered permanent deletion', !(await evaluate('!!document.querySelector("[data-testid=delete-course]")')));
    await click('[data-testid=transition-published]');
    record('admin', 'publishes the reviewed course', await waitFor('document.querySelector("[data-testid=builder-status]").textContent === "Published"', 30000));
    await goto(`/builder/${courseId}`);
    await waitFor('!!document.querySelector("[data-testid=lesson-title]")', 30000);
    record('admin', 'admin can still edit the live course', await evaluate('document.querySelector("[data-testid=lesson-title]").readOnly === false'));
    await logout();

    // ------------------------------------------------------------------ student
    record('student', 'signs in', (await login('student')) === 200);
    const enroll = await evaluate(`fetch('/api/courses/${courseId}/enroll', { method: 'POST', headers: { 'X-FO-CSRF': '1', 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status)`);
    record('student', 'enrols in the published course', enroll === 200, `status ${enroll}`);
    // The course is paid; the run grants it the way an administrator's complimentary access does
    // (no payment provider is called in acceptance runs).
    await db.collection('userCourseAccess').insertOne({ userId: accounts.student.id, courseId, entitlementType: 'complimentary', grantedAt: new Date(), grantedBy: accounts.admin.id });
    await goto(`/courses/${courseId}`);
    record('student', 'course page shows the builder intro and the same modules', await waitFor('!!document.querySelector("[data-testid=course-intro]") && document.querySelectorAll("[data-testid=course-module]").length === 2', 60000));
    const lessonRow = await db.collection('lessons').findOne({ courseId, title: 'Why risk matters' });
    await goto(`/courses/${courseId}/lessons/${lessonRow._id}`);
    await waitFor('!!document.querySelector("[data-testid=lesson-blocks]")', 60000);
    const studentSig = await signature();
    record('student', 'lesson content matches the builder preview exactly', studentSig === previewSig, studentSig === previewSig ? '' : `student: ${studentSig}`);
    record('student', 'outline groups lessons under the same modules', (await evaluate('document.querySelectorAll("[data-testid=outline-module]").length')) === 2);
    const fileHref = await evaluate('document.querySelector("[data-testid=block-file] a")?.getAttribute("href")');
    record('student', 'file link is the access-checked route, not a storage address', /^\/api\/lessons\/[a-f0-9]{24}\/document\?item=b-/.test(fileHref || ''), fileHref);
    const download = await evaluate(`fetch(${js(fileHref)}).then(async (r) => ({ status: r.status, pdf: (await r.text()).startsWith('%PDF') }))`);
    record('student', 'downloads the resource through the gate', download && download.status === 200 && download.pdf, JSON.stringify(download));
    await shot('student-lesson-1280');
    await width(390);
    await sleep(500);
    const wide = await evaluate('(() => { const vw = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > vw + 1).slice(-4).map((e) => e.tagName + "." + String(e.className).slice(0, 60) + " r=" + Math.round(e.getBoundingClientRect().right)).join(" | "); })()');
    record('student', 'lesson page fits a phone (390 px)', await noOverflow(), wide);
    await shot('student-lesson-390');
    await width(1280);
    await waitFor(`[...document.querySelectorAll('[data-testid=lesson-completion] button')].some((b) => /complete/i.test(b.textContent) && !b.disabled)`, 30000);
    await clickText('[data-testid=lesson-completion] button', 'complete');
    let progress = null;
    for (let i = 0; i < 30; i += 1) {
      progress = await db.collection('progress').findOne({ userId: accounts.student.id, courseId });
      if (progress && (progress.completedLessons || []).map(String).includes(String(lessonRow._id))) break;
      await sleep(500);
    }
    record('student', 'completing the lesson records progress', Boolean(progress && (progress.completedLessons || []).map(String).includes(String(lessonRow._id))), JSON.stringify(progress && progress.completedLessons));
    // Direct attempts the server must refuse.
    const builderStatus = await evaluate(`fetch('/api/courses/${courseId}/builder').then((r) => r.status)`);
    record('student', 'cannot open the builder API', builderStatus === 403, `status ${builderStatus}`);
    await goto(`/builder/${courseId}`);
    record('student', 'the builder page sends students away', await waitFor('!location.pathname.startsWith("/builder")', 60000));
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

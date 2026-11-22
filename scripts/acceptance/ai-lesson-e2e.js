/**
 * AI lesson development acceptance run: the REAL application in headless Microsoft Edge with an
 * isolated test database and a LOCAL TEST-DOUBLE provider (scripts/acceptance/fake-ai-provider.js,
 * OpenAI-compatible), so the full instructor -> admin -> student workflow runs without a real AI
 * provider, network access or quota. Same safety rules as scripts/acceptance/run.js (guard.js).
 *
 *   ACCEPTANCE_MONGODB_URI=mongodb://127.0.0.1:27099/?replicaSet=rs15 \
 *   ACCEPTANCE_DB_NAME=forexorbit_ai_acceptance \
 *   node scripts/acceptance/ai-lesson-e2e.js [--reset] [--port 3330] [--shots <dir>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { MongoClient, ObjectId } = require('mongodb');
const { checkAcceptanceConfig, checkDisposable, MARKER, MARKER_COLLECTION, shieldLocalEnv } = require('./guard');
const { launchBrowser, sleep } = require('./browser');
const { startFakeProvider } = require('./fake-ai-provider');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(option('--port', '3330'));
const BASE = `http://localhost:${PORT}`;
const SHOTS = option('--shots', fs.mkdtempSync(path.join(os.tmpdir(), 'fo-ai-shots-')));
const ASSETS = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-ai-assets-'));
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(role, check, ok, detail = '') {
  results.push({ role, check, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${role}] ${check}${detail ? ` (${detail})` : ''}`);
}

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
  for (const role of ['instructor', 'admin', 'student']) {
    const password = `Acc-${crypto.randomBytes(12).toString('base64url')}-9a!`;
    const email = `ai-${role}@acceptance.invalid`;
    const res = await db.collection('users').insertOne({ name: `AI ${role}`, email, password: await bcrypt.hash(password, 10), role, status: 'approved', sessionGeneration: 0, createdAt: new Date() });
    accounts[role] = { id: String(res.insertedId), email, password };
  }
  // An existing course with its curriculum (synthetic fixture for this isolated database).
  const courseId = new ObjectId();
  await db.collection('courses').insertOne({ _id: courseId, title: 'Forex Trading Fundamentals', description: '<p>The foundations of currency trading for complete beginners.</p>', category: 'basics', difficulty: 'beginner', thumbnail: '', status: 'draft', instructorId: accounts.instructor.id, freePreviewExplicit: true, modules: [{ id: 'modintro1', title: 'Introduction to Forex' }], createdAt: new Date(), updatedAt: new Date() });
  const lessons = [
    { title: 'What is Forex Trading?', blocks: [{ id: 'seed0001', type: 'text', ops: [{ insert: 'Forex is the global market where currencies are exchanged.\n' }] }] },
    { title: 'Understanding Currency Pairs', blocks: [{ id: 'seed0002', type: 'text', ops: [{ insert: `${'A currency pair shows how much of the quote currency buys one unit of the base currency. '.repeat(6)}\n` }] }] },
    { title: 'Understanding Pips and Lots' },
  ];
  const ids = [];
  for (const [i, l] of lessons.entries()) {
    const r = await db.collection('lessons').insertOne({ courseId: String(courseId), moduleId: 'modintro1', order: i + 1, title: l.title, ...(l.blocks ? { blocks: l.blocks, contentFormat: 'blocks' } : {}), revision: 1, type: 'interactive', createdAt: new Date(), updatedAt: new Date() });
    ids.push(String(r.insertedId));
  }
  return { accounts, courseId: String(courseId), lessonIds: ids };
}

async function main() {
  const config = checkAcceptanceConfig(process.env);
  if (!config.ok) throw new Error(config.reason);
  const client = new MongoClient(config.uri);
  await client.connect();
  const db = client.db(config.dbName);
  const { accounts, courseId, lessonIds } = await seed(db);
  const fake = await startFakeProvider();
  const logFile = path.join(os.tmpdir(), `fo-ai-server-${PORT}.log`);
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'development', PORT: String(PORT), MONGO_URI: config.uri, MONGODB_DB_NAME: config.dbName, JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_ADS_ENABLED: 'false', COURSE_ASSETS_LOCAL_DIR: ASSETS,
    AI_LESSON_PROVIDER: 'compatible', AI_LESSON_BASE_URL: fake.url, AI_LESSON_API_KEY: 'acceptance-only', AI_LESSON_MODEL: 'test-double-model',
  };
  const app = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: shieldLocalEnv(env), stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready; i += 1) {
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      if (/Server is ready/.test(log)) { try { ready = (await fetch(`${BASE}/api/courses`)).status < 500; } catch { /* not yet */ } }
      if (!ready) await sleep(1000);
    }
    record('setup', 'application started with the test-double AI provider', ready);
    browser = await launchBrowser(9351, 'ai');
    const t = browser.first;
    const { evaluate, waitFor, send } = t;
    await send('DOM.enable');
    await send('Runtime.enable');
    t.on('Page.javascriptDialogOpening', () => { void send('Page.handleJavaScriptDialog', { accept: true }); });
    const errors = [];
    t.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails && p.exceptionDetails.text));
    const width = (w, h = 900) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    const goto = async (url) => { await send('Page.navigate', { url: `${BASE}${url}` }); await sleep(400); await waitFor('document.readyState === "complete"', 60000); };
    const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); if (r.data) fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64')); };
    const js = (s) => JSON.stringify(s);
    const click = (selector) => evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; el.click(); return true; })()`);
    const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
    const typeInto = async (selector, text) => { const ok = await evaluate(`(() => { const els = document.querySelectorAll(${js(selector)}); const el = els[els.length - 1]; if (!el) return false; el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`); if (ok) await send('Input.insertText', { text }); return ok; };
    const login = async (who) => { await goto('/login'); return evaluate(`fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-FO-CSRF': '1' }, body: JSON.stringify({ email: ${js(accounts[who].email)}, password: ${js(accounts[who].password)} }) }).then((r) => r.status)`); };
    const logout = () => evaluate(`fetch('/api/auth/logout', { method: 'POST', headers: { 'X-FO-CSRF': '1' } }).then((r) => r.status)`);
    const saved = () => waitFor(`[...document.querySelectorAll('[data-testid="save-status"]')].every((x) => x.dataset.status === 'saved')`, 30000);
    const blockTypes = () => evaluate('[...document.querySelectorAll("[data-testid=block-editor]")].map((b) => b.dataset.blockType).join(",")');
    const openLesson = async (lessonId) => { await goto(`/builder/${courseId}?lesson=${lessonId}`); return waitFor('!!document.querySelector("[data-testid=ai-panel]")', 60000); };
    const openPanel = async () => { if (!(await evaluate('document.querySelector("[data-testid=ai-toggle]")?.getAttribute("aria-expanded") === "true"'))) await click('[data-testid=ai-toggle]'); return waitFor('!!document.querySelector("[data-testid=ai-request]") || !!document.querySelector("[data-testid=ai-not-configured]")', 30000); };
    await width(1280);

    // ------------------------------------------------------------------ instructor
    record('instructor', 'signs in', (await login('instructor')) === 200);
    record('instructor', 'opens the existing course and selects an existing, empty topic', await openLesson(lessonIds[2]));
    record('instructor', 'existing curriculum is shown unchanged', (await evaluate('[...document.querySelectorAll("[data-testid=curriculum-lesson]")].map((l) => l.innerText.split("\\n").find((x) => x.length > 3)).join(" | ")')) === 'What is Forex Trading? | Understanding Currency Pairs | Understanding Pips and Lots');
    await openPanel();
    record('instructor', 'the assistant offers "Generate lesson" for a topic with no content', await evaluate('!!document.querySelector("[data-testid=ai-mode-generate][aria-checked=true]")'));
    await fill('[data-testid=ai-instructions]', 'Use EUR/USD in the examples.');
    await click('[data-testid=ai-generate]');
    const generated = await waitFor('!!document.querySelector("[data-testid=ai-proposal]")', 90000);
    record('instructor', 'generates a lesson for the topic (state: Generated, saved as draft)', generated && (await evaluate('document.querySelector("[data-testid=ai-proposal]").innerText.includes("saved as a draft")')));
    const lastPrompt = fake.requests[fake.requests.length - 1]?.prompt || '';
    record('instructor', 'the provider received the real course, module and topic context', /Topic \(lesson 3 of 3\): Understanding Pips and Lots/.test(lastPrompt) && /Module: Introduction to Forex/.test(lastPrompt) && /What is Forex Trading\?/.test(lastPrompt));
    const previewTypes = await evaluate('[...document.querySelectorAll("[data-testid=ai-preview] [data-testid=lesson-blocks] > div")].map((d) => d.dataset.block).join(",")');
    record('instructor', 'reviews the generated sections in the student renderer', /heading,text/.test(previewTypes) && /code/.test(previewTypes), previewTypes);
    await shot('ai-proposal-preview-1280');
    await click('[data-testid=ai-tab-quality]');
    record('instructor', 'sees the quality checklist (never "verified")', await waitFor('!!document.querySelector("[data-testid=ai-quality]") && document.querySelector("[data-testid=ai-quality]").innerText.includes("Reviewed by an instructor")', 10000));
    await click('[data-testid=ai-tab-compare]');
    record('instructor', 'compares the proposal with the current (empty) topic', await waitFor('!!document.querySelector("[data-testid=ai-compare]")', 10000));
    await shot('ai-compare-1280');
    record('instructor', 'the lesson itself is still empty before acceptance', (await db.collection('lessons').findOne({ _id: new ObjectId(lessonIds[2]) })).blocks === undefined);
    await click('[data-testid=ai-accept]');
    record('instructor', 'accepts into the lesson (previous version kept)', await waitFor('document.querySelectorAll("[data-testid=block-editor]").length > 5', 30000));
    const after = await db.collection('lessons').findOne({ _id: new ObjectId(lessonIds[2]) });
    record('instructor', 'accepted content is stored as ordinary lesson blocks; topic title unchanged', Array.isArray(after.blocks) && after.title === 'Understanding Pips and Lots' && (after.history || []).length === 1);
    const quiz = await db.collection('quizzes').findOne({ lessonId: lessonIds[2] });
    record('instructor', 'knowledge checks became a draft quiz', Boolean(quiz && quiz.settings.status === 'draft' && quiz.questions.length >= 2));
    // Edit the generated content manually.
    await fill('input[aria-label="Heading text"]', 'Introduction to pips');
    record('instructor', 'edits the generated content and it autosaves', await saved());
    // Student preview of the accepted lesson.
    await click('[data-testid=view-preview]');
    record('instructor', 'previews the lesson exactly as students will see it', await waitFor('!!document.querySelector("[data-testid=lesson-preview] [data-testid=lesson-blocks]")', 20000));
    const previewSig = await evaluate('[...document.querySelectorAll("[data-testid=lesson-preview] [data-testid=lesson-blocks] > div")].map((d) => d.dataset.block + ":" + d.innerText.replace(/\\s+/g, " ").trim().slice(0, 60)).join(" | ")');
    await click('[data-testid=view-edit]');

    // Improve an existing lesson, reject it, confirm the original stays.
    await openLesson(lessonIds[1]);
    const originalTypes = await blockTypes();
    await openPanel();
    await click('[data-testid=ai-mode-improve]');
    await click('[data-testid=ai-generate]');
    await waitFor('!!document.querySelector("[data-testid=ai-proposal]")', 90000);
    await click('[data-testid=ai-reject]');
    await sleep(1000);
    const afterReject = await db.collection('lessons').findOne({ _id: new ObjectId(lessonIds[1]) });
    record('instructor', 'rejects an improvement and the original lesson remains intact', (await blockTypes()) === originalTypes && afterReject.blocks.length === 1 && afterReject.blocks[0].id === 'seed0002');
    // Expand and accept.
    await click('[data-testid=ai-mode-expand]');
    await click('[data-testid=ai-generate]');
    await waitFor('!!document.querySelector("[data-testid=ai-proposal]")', 90000);
    await click('[data-testid=ai-accept]');
    record('instructor', 'accepts an expansion of an existing lesson', await waitFor('document.querySelectorAll("[data-testid=block-editor]").length > 3', 30000));
    // Generate one section only.
    await openPanel().catch(() => undefined);
    await evaluate('document.querySelector("[data-testid=ai-panel]")?.scrollIntoView()');
    await click('[data-testid=ai-mode-section]');
    await click('[data-testid=ai-generate]');
    record('instructor', 'generates a single section without rewriting the lesson', await waitFor('!!document.querySelector("[data-testid=ai-proposal]")', 90000));
    await click('[data-testid=ai-reject]');
    await sleep(500);

    // Manual creation and upload still work alongside AI.
    await evaluate(`document.querySelectorAll('[data-testid=add-lesson]')[0].click()`);
    await waitFor('document.querySelectorAll("[data-testid=curriculum-lesson]").length === 4', 30000);
    await sleep(800);
    await fill('[data-testid=lesson-title]', 'Placing your first trade');
    await click('[data-testid=add-block]'); await sleep(150); await click('[data-testid=add-text]');
    await waitFor('document.querySelectorAll(".builder-quill .ql-editor").length >= 1', 30000);
    await typeInto('.builder-quill .ql-editor', 'Written by hand: choose the pair, the direction and the size before you click.');
    await click('[data-testid=add-block]'); await sleep(150); await click('[data-testid=add-file]');
    const pdf = path.join(os.tmpdir(), `fo-ai-plan-${Date.now()}.pdf`);
    fs.writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');
    const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
    const inputs = await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: '[data-block-type=file] input[type=file]' });
    await send('DOM.setFileInputFiles', { files: [pdf], nodeId: inputs.nodeIds[inputs.nodeIds.length - 1] });
    record('instructor', 'manual lesson creation and file upload still work', (await waitFor('document.body.innerText.includes("stored privately")', 60000)) && (await saved()));

    // Submit for review.
    await goto(`/builder/${courseId}?tab=publish`);
    await waitFor('!!document.querySelector("[data-testid=transition-in_review]")', 30000);
    record('instructor', 'AI-generated content is not published automatically (course still Draft)', (await evaluate('document.querySelector("[data-testid=builder-status]").textContent')) === 'Draft');
    await click('[data-testid=transition-in_review]');
    record('instructor', 'submits for review through the normal workflow', await waitFor('document.querySelector("[data-testid=builder-status]").textContent === "In review"', 30000));
    await openLesson(lessonIds[0]);
    await openPanel();
    record('instructor', 'cannot apply AI changes while the course is in review', await evaluate('document.querySelector("[data-testid=ai-generate]")?.disabled === true'));
    await logout();

    // ------------------------------------------------------------------ admin
    record('admin', 'signs in', (await login('admin')) === 200);
    await openLesson(lessonIds[0]);
    await openPanel();
    record('admin', 'the same assistant is available in the admin builder', await evaluate('!!document.querySelector("[data-testid=ai-generate]") && !document.querySelector("[data-testid=ai-generate]").disabled'));
    await goto(`/builder/${courseId}?tab=publish`);
    await waitFor('!!document.querySelector("[data-testid=transition-published]")', 30000);
    await click('[data-testid=transition-published]');
    record('admin', 'publishes through the authorized workflow', await waitFor('document.querySelector("[data-testid=builder-status]").textContent === "Published"', 30000));
    await logout();

    // ------------------------------------------------------------------ student
    record('student', 'signs in', (await login('student')) === 200);
    const enroll = await evaluate(`fetch('/api/courses/${courseId}/enroll', { method: 'POST', headers: { 'X-FO-CSRF': '1', 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status)`);
    await db.collection('userCourseAccess').insertOne({ userId: accounts.student.id, courseId, entitlementType: 'complimentary', grantedAt: new Date() });
    record('student', 'enrols', enroll === 200);
    await goto(`/courses/${courseId}/lessons/${lessonIds[2]}`);
    await waitFor('!!document.querySelector("[data-testid=lesson-blocks]")', 60000);
    const studentSig = await evaluate('[...document.querySelectorAll("[data-testid=lesson-blocks] > div")].map((d) => d.dataset.block + ":" + d.innerText.replace(/\\s+/g, " ").trim().slice(0, 60)).join(" | ")');
    record('student', 'the published AI-developed lesson appears exactly as previewed', studentSig === previewSig, studentSig === previewSig ? '' : studentSig.slice(0, 200));
    await shot('student-ai-lesson-1280');
    const aiApi = await evaluate(`fetch('/api/lessons/${lessonIds[2]}/ai').then((r) => r.status)`);
    record('student', 'cannot reach the AI generation API', aiApi === 403, `status ${aiApi}`);
    const leaked = await evaluate(`fetch('/api/lessons/${lessonIds[2]}').then((r) => r.json()).then((j) => ('aiProposals' in j) || ('history' in j))`);
    record('student', 'lesson responses carry no proposals or history', leaked === false);
    await waitFor(`[...document.querySelectorAll('[data-testid=lesson-completion] button')].some((b) => /complete/i.test(b.textContent) && !b.disabled)`, 30000);
    await evaluate(`[...document.querySelectorAll('[data-testid=lesson-completion] button')].find((b) => /complete/i.test(b.textContent))?.click()`);
    let completed = false;
    for (let i = 0; i < 30 && !completed; i += 1) {
      const progress = await db.collection('progress').findOne({ userId: accounts.student.id, courseId });
      completed = Boolean(progress && (progress.completedLessons || []).map(String).includes(lessonIds[2]));
      if (!completed) await sleep(500);
    }
    record('student', 'progress is recorded on the AI-developed lesson', completed);
    await width(390);
    await sleep(400);
    record('student', 'lesson fits a phone (390 px)', await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'));
    await shot('student-ai-lesson-390');
    record('all', 'no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    if (browser) await browser.quit();
    app.kill();
    await fake.close();
    await client.close();
    fs.rmSync(ASSETS, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err && err.message ? err.message : err); process.exit(1); });

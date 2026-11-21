/**
 * Practical trading tasks: frontend contract (source checks, no browser). Pages exist and are wired
 * to the right APIs; text is never rendered as HTML; evidence is opened only through the API;
 * grading sends the revision it read; the desk opens from a task with the simulated disclosure.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const UI = [
  'components/practical/Common.tsx',
  'components/practical/StudentTasks.tsx',
  'components/practical/TaskEditor.tsx',
  'components/practical/TaskPreview.tsx',
  'components/practical/TasksCard.tsx',
  'pages/student-dashboard/practical/[id].tsx',
  'pages/instructor/practical-tasks/index.tsx',
  'pages/instructor/practical-tasks/new.tsx',
  'pages/instructor/practical-tasks/[id].tsx',
  'pages/instructor/practical-tasks/review/[attemptId].tsx',
];

test('every practical task screen exists and renders text as text', () => {
  for (const file of UI) {
    const src = read(file);
    assert.equal(/dangerouslySetInnerHTML/.test(src), false, file);
    assert.equal(/cloudinary|res\.cloudinary\.com/i.test(src), false, `${file} must not reference storage directly`);
  }
});

test('client bundles never import server-only modules', () => {
  for (const file of UI) {
    const src = read(file);
    for (const banned of ['@/lib/practical-tasks\'', '@/lib/practical-grading', '@/lib/mongodb', '@/lib/trading/engine', '@/lib/cloudinary']) {
      // Type-only imports are erased at build time.
      const lines = src.split('\n').filter((l) => l.includes(banned) && l.startsWith('import ') && !l.startsWith('import type'));
      assert.deepEqual(lines, [], `${file} imports ${banned}`);
    }
  }
});

test('the student workspace uses the task APIs, freezes nothing on the client, and discloses simulation', () => {
  const page = read('pages/student-dashboard/practical/[id].tsx');
  for (const api of ['/practical-tasks/${id}/attempt', '/practical-tasks/${task.id}/attempt', '/practical-tasks/${task.id}/evidence', '/practical-tasks/${task.id}/submit']) assert.ok(page.includes(api), api);
  assert.match(page, /confirm: true/);
  assert.match(page, /SimulatedNote/);
  assert.match(page, /not verified records/);
  assert.match(page, /section=live&instrument=/);
  // The student never types trade figures for the simulator: only position ids are sent.
  assert.match(page, /positionIds: selected/);
  const dash = read('pages/student-dashboard.tsx');
  assert.match(dash, /<StudentPracticalTasks \/>/);
  assert.match(dash, /initialInstrument=\{deskInstrument\}/);
  assert.match(dash, /Prices are simulated, not live/);
  assert.match(read('pages/dashboard.tsx'), /<PracticalTasksCard \/>/);
  assert.match(read('components/TradingInterface.tsx'), /initialInstrument/);
});

test('the instructor flows: wizard with both methods, default grading, confirmation, concurrency', () => {
  const wizard = read('pages/instructor/practical-tasks/new.tsx');
  assert.match(wizard, /\/practical-tasks\/generate/);
  assert.match(wizard, /\/practical-tasks\/preview/);
  assert.match(wizard, /'generate'.*'manual'|Generate from a template[\s\S]*Build it yourself/);
  const editor = read('components/practical/TaskEditor.tsx');
  assert.match(editor, /gradingMode: 'automatic'/);
  assert.match(editor, />Default</);
  const detail = read('pages/instructor/practical-tasks/[id].tsx');
  assert.match(detail, /expectedVersion: t!\.version/);
  assert.match(detail, /confirmPolicyChange: true, reason/);
  assert.match(detail, /setConfirm\('publish'\)/);
  const review = read('pages/instructor/practical-tasks/review/[attemptId].tsx');
  assert.match(review, /expectedRevision: a\.revision/);
  assert.match(review, /status === 409/);
  assert.match(review, /not verified records/);
  assert.match(read('components/instructor/portal/PortalShell.tsx'), /\/instructor\/practical-tasks/);
  assert.match(read('components/Sidebar.tsx'), /\/instructor\/practical-tasks/);
});

test('result report keeps system findings and instructor conclusions apart', () => {
  const common = read('components/practical/Common.tsx');
  assert.match(common, /System: /);
  assert.match(common, /Instructor: /);
  assert.match(common, /Adjusted by your instructor/);
  assert.match(common, /Student-reported · not verified/);
});

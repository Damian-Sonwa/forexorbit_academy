/**
 * Phase 12: instructor portal UI. Components are compiled from source and rendered to static markup
 * with next/link stubbed (effects do not run); pages are checked at the source level for their
 * guards, data sources and states. No browser here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadModule } = require('./helpers/ts-loader');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

const stubs = {
  'next/link': ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children),
  'next/router': { useRouter: () => ({ pathname: '/instructor/grading', query: {}, isReady: true, push: async () => true, replace: async () => true }) },
  '@/components/ui/OrbitProgress': () => null,
  '@/components/Header': () => null,
  '@/components/Footer': () => null,
  '@/components/Sidebar': () => null,
  '@/components/LoadingSpinner': () => null,
  '@/hooks/useAuth': { useAuth: () => ({ user: { role: 'instructor' }, isAuthenticated: true, loading: false }) },
  '@/components/CourseCover': () => null,
  '@/lib/api-client': { apiClient: { get: async () => ({}), post: async () => ({}), put: async () => ({}) }, isUnauthorizedError: () => false },
};

function compile(relative, cache = new Map()) {
  const file = path.join(ROOT, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = (id) => {
    if (id in stubs) { const s = stubs[id]; return typeof s === 'function' ? { __esModule: true, default: s } : s; }
    if (id === '@/lib/plain-text') return loadModule('lib/plain-text.ts');
    if (id === '@/lib/safe-url') return require('../lib/safe-url');
    if (id.startsWith('@/components/')) {
      const base = id.replace('@/', '');
      for (const ext of ['.tsx', '.ts']) if (fs.existsSync(path.join(ROOT, base + ext))) return compile(base + ext, cache);
    }
    if (id.startsWith('./')) {
      const base = path.join(path.dirname(relative), id);
      for (const ext of ['.tsx', '.ts']) if (fs.existsSync(path.join(ROOT, base + ext))) return compile(base + ext, cache);
    }
    return require(id);
  };
  new Function('exports', 'require', 'module', code)(mod.exports, localRequire, mod);
  return mod.exports;
}

const V = compile('components/instructor/portal/Views.tsx');
const G = compile('components/instructor/portal/GradeForm.tsx');
const Shell = compile('components/instructor/portal/PortalShell.tsx');
const LAP = compile('components/instructor/LessonAssignmentsPanel.tsx');

const metrics = { courses: 2, coursesByStatus: { draft: 1, in_review: 0, published: 1, archived: 0 }, students: 2, enrollments: 2, completionRate: 50, averageProgress: 75, activeLearners7d: 1, pendingSubmissions: 3, latePending: 1, gradedSubmissions: 4, oldestPendingAt: new Date(Date.now() - 2 * 86400000).toISOString(), quizAttempts: 2, quizPassRate: 50, quizAveragePercent: 65 };

test('teaching metrics and grading call-out: server figures, a clear next step', () => {
  const out = html(h(V.TeachingMetrics, { m: metrics }));
  assert.match(out, /data-testid="tm-courses">2</);
  assert.match(out, /1 published · 1 draft/);
  assert.match(out, /data-testid="tm-completion">50%</);
  assert.match(out, /data-testid="tm-pending">3</);
  assert.match(out, /1 late/);
  const call = html(h(V.GradingCallout, { m: metrics }));
  assert.match(call, /3<\/span> submissions waiting for a grade, the oldest from 2 days ago · 1 late\./);
  assert.match(call, /href="\/instructor\/grading"/);
  assert.match(html(h(V.GradingCallout, { m: { ...metrics, pendingSubmissions: 0 } })), /data-testid="grading-clear"/);
});

test('course table: titles as text, status, workload, links to manage and students', () => {
  const out = html(h(V.CourseTable, { courses: [{ courseId: 'c1', title: 'Price <i>Action</i>', status: 'published', difficulty: 'beginner', lessons: 4, enrollments: 2, completionRate: 50, averageProgress: 75, pendingSubmissions: 3, updatedAt: null }] }));
  assert.ok(!out.includes('<i>'));
  assert.match(out, /Price Action/);
  assert.match(out, /href="\/instructor\/courses\/c1"/);
  assert.match(out, /href="\/instructor\/students\?courseId=c1"/);
  assert.match(html(h(V.CourseTable, { courses: [] })), /data-testid="courses-none"/);
});

test('student table: a card layout for phones and a table for wider screens, both linking to the student', () => {
  const row = { studentId: 's1', name: 'Sam', level: 'beginner', courseId: 'c1', courseTitle: 'Price Action', status: 'in_progress', progress: 50, completedLessons: 1, totalLessons: 2, enrolledAt: null, lastActivityAt: new Date().toISOString(), activeRecently: true, quiz: { attempts: 1, averagePercent: 90, passed: 1 }, submissions: { submitted: 1, pending: 1, graded: 0 } };
  const out = html(h(V.StudentTable, { rows: [row] }));
  assert.match(out, /class="space-y-2 md:hidden" data-testid="student-cards"/);
  assert.match(out, /class="hidden overflow-x-auto[^"]*md:block"/);
  assert.equal((out.match(/href="\/instructor\/students\/s1\?courseId=c1"/g) || []).length, 2);
  assert.match(out, /1 to grade/);
  assert.match(out, /aria-valuenow="50"/);
  assert.match(html(h(V.StudentTable, { rows: [] })), /data-testid="students-none"/);
});

test('grading queue: selection, late and graded states', () => {
  const rows = [
    { submissionId: 'a', assignmentId: 'x', assignmentTitle: 'Trend', points: 50, dueDate: null, courseId: 'c', courseTitle: 'PA', studentId: 's', student: 'Sam', status: 'pending', grade: null, late: true, submittedAt: new Date().toISOString(), gradedAt: null, preview: 'text', hasFile: false },
    { submissionId: 'b', assignmentId: 'x', assignmentTitle: 'Trend', points: 50, dueDate: null, courseId: 'c', courseTitle: 'PA', studentId: 't', student: 'Tia', status: 'graded', grade: 80, late: false, submittedAt: new Date().toISOString(), gradedAt: null, preview: 'text', hasFile: false },
  ];
  const out = html(h(V.QueueList, { rows, selectedId: 'a', onSelect: () => {} }));
  assert.match(out, /aria-current="true"[^>]*data-testid="queue-item-a"/);
  assert.match(out, /Late/);
  assert.match(out, /80\/100/);
  assert.match(html(h(V.QueueList, { rows: [], selectedId: null, onSelect: () => {} })), /data-testid="queue-empty"/);
});

test('review: the brief, the work, an unsafe file link withheld, and the history with reasons', () => {
  const review = {
    submission: { submissionId: 'a', studentId: 's', student: 'Sam', status: 'graded', grade: 90, feedback: 'Better', late: true, submittedAt: new Date().toISOString(), gradedAt: null, submissionText: 'My <b>trend</b> lines', submissionFile: 'javascript:alert(1)', gradeVersion: 2, gradeHistory: [{ grade: 80, previousGrade: null, feedback: 'Good', reason: null, gradedBy: 'Ada', gradedAt: null }, { grade: 90, previousGrade: 80, feedback: 'Better', reason: 'Re-marked', gradedBy: 'Ada', gradedAt: null }], previousVersions: [] },
    assignment: { assignmentId: 'x', title: 'Trend', instructions: 'Draw the trend', description: '', points: 50, dueDate: null, courseId: 'c', courseTitle: 'PA', lessonId: null },
  };
  const out = html(h(V.ReviewBody, { review }));
  assert.match(out, /data-testid="review-text">My &lt;b&gt;trend&lt;\/b&gt; lines</, 'student work is text, never markup');
  assert.ok(!out.includes('javascript:'), 'unsafe link not rendered');
  assert.match(out, /not a safe address/);
  assert.match(out, /80 → 90/);
  assert.match(out, /Reason: Re-marked/);
  assert.match(out, /Draw the trend/);
});

test('grade form rule: a reason only when an existing grade changes; whole grades 0-100', () => {
  const s = (o) => G.gradeFormState({ grade: '', feedback: '', reason: '', currentGrade: null, ...o });
  assert.deepEqual([s({ grade: '70' }).canSave, s({ grade: '70' }).changing], [true, false]);
  assert.equal(s({ grade: '101' }).canSave, false);
  assert.equal(s({ grade: '' }).canSave, false);
  assert.deepEqual([s({ grade: '80', currentGrade: 80 }).changing, s({ grade: '80', currentGrade: 80 }).canSave], [false, true]);
  assert.deepEqual([s({ grade: '90', currentGrade: 80 }).changing, s({ grade: '90', currentGrade: 80 }).canSave], [true, false]);
  assert.equal(s({ grade: '90', currentGrade: 80, reason: 'Re-marked' }).canSave, true);
  assert.equal(s({ grade: '90', feedback: 'x'.repeat(5001) }).canSave, false);
  assert.equal(G.REASON_MIN, 5);
  // The old per-assignment form follows the same rule.
  assert.match(read('components/instructor/SubmissionGradeForm.tsx'), /gradeFormState\(\{ grade, feedback, reason, currentGrade: submission\.grade \}\)/);
});

test('activity log: grade changes show before and after with the reason; reassignments show direction', () => {
  const rows = [
    { id: '1', action: 'assignment_regraded', label: 'Changed a grade', at: null, courseTitle: 'PA', assignmentTitle: 'Trend', student: 'Sam', before: { grade: 80 }, after: { grade: 90 }, reason: 'Re-marked', byYou: true, direction: null },
    { id: '2', action: 'course_reassigned', label: 'Course reassigned', at: null, courseTitle: 'Risk', assignmentTitle: null, student: null, before: null, after: null, reason: 'Leave', byYou: false, direction: 'assigned_to_you' },
  ];
  const out = html(h(V.ActivityLog, { rows }));
  assert.match(out, /80 → 90/);
  assert.match(out, /Reason: Re-marked/);
  assert.match(out, /assigned to you/);
});

test('portal navigation: the teaching areas, the active one marked, a grading badge', () => {
  const out = html(h(Shell.PortalNav, { pathname: '/instructor/grading', badges: { Grading: 3 } }));
  for (const href of ['/instructor/overview', '/instructor/students', '/instructor/grading', '/instructor/activity', '/instructor/profile']) assert.ok(out.includes(`href="${href}"`), href);
  assert.match(out, /href="\/instructor\/grading" aria-current="page"[^>]*>Grading<span[^>]*>3<\/span>/);
  assert.match(out, /overflow-x-auto/, 'scrolls on phones');
  const sidebar = read('components/Sidebar.tsx');
  for (const href of ['/instructor/overview', '/instructor/students', '/instructor/grading', '/instructor/activity']) assert.ok(sidebar.includes(`href: '${href}'`), href);
});

test('assignment panel: status choices follow draft, published and closed', () => {
  assert.deepEqual(LAP.NEXT_STATUS.draft.map((n) => n.to), ['published']);
  assert.deepEqual(LAP.NEXT_STATUS.published.map((n) => n.to), ['closed', 'draft']);
  assert.deepEqual(LAP.NEXT_STATUS.closed.map((n) => n.to), ['published']);
  assert.match(read('components/instructor/LessonAssignmentsPanel.tsx'), /apiClient\.put\(`\/assignments\/\$\{row\._id\}`, \{ status: to \}\)/);
});

test('pages: guarded shell, server data sources, loading and error states, no HTML sinks', () => {
  const pages = {
    'pages/instructor/overview.tsx': '/instructor/overview',
    'pages/instructor/students/index.tsx': '/instructor/students?',
    'pages/instructor/students/[studentId].tsx': '/instructor/students/',
    'pages/instructor/grading.tsx': '/instructor/submissions?',
    'pages/instructor/activity.tsx': '/instructor/activity?page=',
    'pages/instructor/profile.tsx': '/instructor/profile',
  };
  for (const [file, endpoint] of Object.entries(pages)) {
    const src = read(file);
    assert.match(src, /<PortalShell/, file);
    assert.ok(src.includes(endpoint), `${file} reads ${endpoint}`);
    assert.match(src, /ErrorState text=\{[^}]*error\}/, `${file} error state`);
    assert.match(src, /Skeleton/, `${file} loading state`);
    assert.ok(!src.includes('dangerouslySetInnerHTML'), file);
  }
  const shell = read('components/instructor/portal/PortalShell.tsx');
  assert.match(shell, /else if \(user && !STAFF\.has\(user\.role\)\) router\.replace\('\/dashboard'\);/, 'students are sent away (the APIs refuse them anyway)');
  const grading = read('pages/instructor/grading.tsx');
  assert.match(grading, /\/instructor\/submissions\/\$\{selected\}/);
  assert.match(grading, /lg:grid-cols-\[22rem_minmax\(0,1fr\)\]/, 'queue beside the review on wide screens; stacked on phones');
  assert.match(grading, /const next = queue\.data\?\.rows\.find/, 'moves to the next ungraded work after saving');
});

test('admin reassignment dialog: active instructors only, a reason, the history', () => {
  const src = read('components/admin/CourseReassignDialog.tsx');
  assert.match(src, /reason\.trim\(\)\.length >= 5/);
  assert.match(src, /apiClient\.post\(`\/admin\/courses\/\$\{courseId\}\/reassign`, \{ instructorId: target, reason: reason\.trim\(\) \}\)/);
  assert.match(src, /role="dialog" aria-modal="true"/);
  const admin = read('pages/admin/index.tsx');
  assert.match(admin, /member\.role === 'instructor' && \(!member\.status \|\| member\.status === 'approved'\)\)\.map/, 'only active instructors are offered');
  assert.match(admin, /data-testid="reassign-open"/);
});

// ---------------------------------------------------------------------------
// Mobile layout and rich-text titles (follow-up audit)
// ---------------------------------------------------------------------------

test('quiz results (Progress): rich-text lesson titles render as plain text', () => {
  const src = read('components/AssessmentHistory.tsx');
  assert.match(src, /\{previewText\(r\.lessonTitle\) \|\| 'Lesson'\}/);
  assert.match(src, /\{previewText\(r\.courseTitle\) \|\| 'Course'\}/);
  const { previewText } = loadModule('lib/plain-text.ts');
  assert.equal(previewText('<h2><strong>Introduction to Forex (</strong>The Foundations &amp; Language of Forex)</h2>'), 'Introduction to Forex (The Foundations & Language of Forex)');
  assert.equal(previewText('<h2><strong>Market Sentiment Analysis<span class="ql-cursor"></span></strong></h2>'), 'Market Sentiment Analysis');
});

test('mobile: grid children may shrink, and the wide-content grids have one column on phones', () => {
  assert.match(read('styles/globals.css'), /@layer base \{\s*\.grid > \* \{\s*min-width: 0;/);
  for (const file of ['pages/instructor/overview.tsx', 'pages/instructor/profile.tsx', 'pages/instructor/grading.tsx', 'pages/instructor/students/[studentId].tsx', 'pages/dashboard.tsx', 'components/student/dashboard/PracticePanel.tsx', 'components/TradingInterface.tsx']) {
    const grids = read(file).match(/className="[^"]*\bgrid\b[^"]*(?:sm|md|lg|xl):grid-cols-\[[^"]*"/g) || [];
    for (const g of grids) assert.ok(/\bgrid-cols-1\b/.test(g), `${file}: ${g}`);
  }
  // Native selects size to their longest option: full width on phones.
  assert.match(read('pages/instructor/grading.tsx'), /className="input w-full sm:!w-56" aria-label="Course"/);
  assert.match(read('pages/instructor/students/index.tsx'), /className="input mt-1\.5 w-full sm:!w-56"/);
});

test('mobile: due-soon items stack; the course table hides its action column and links the title', () => {
  const panels = read('components/student/dashboard/Panels.tsx');
  assert.match(panels, /className="flex flex-col gap-2\.5 px-4 py-3\.5 sm:flex-row sm:items-center sm:gap-4"/);
  assert.match(panels, /className="card flex flex-col gap-3 !p-4 sm:flex-row sm:items-start"/);
  const out = html(h(V.CourseTable, { courses: [{ courseId: 'c1', title: 'Price Action', status: 'published', difficulty: 'beginner', lessons: 4, enrollments: 2, completionRate: 50, averageProgress: 75, pendingSubmissions: 3, updatedAt: null }] }));
  assert.match(out, /<a href="\/instructor\/courses\/c1" class="line-clamp-2 hover:underline">Price Action<\/a>/);
  assert.match(out, /<td class="hidden whitespace-nowrap text-right sm:table-cell">/);
});

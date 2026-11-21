/**
 * Phase 11: student dashboard UI. Components are compiled from source and rendered to static markup
 * (react-dom/server) with next/link and the cover/progress visuals stubbed. Effects do not run in
 * this mode, so fetching parts are covered by their initial render and by source checks. The
 * service output for an empty student is rendered too, so the UI is checked against the real
 * response shape. No browser here: see the report for what was verified in a browser.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadModule } = require('./helpers/ts-loader');
const { memoryDb } = require('./helpers/memory-db');
const A = require('../lib/student-analytics');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const NOW = new Date('2026-11-21T10:00:00Z');

const stubs = {
  'next/link': ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children),
  '@/components/ui/OrbitProgress': ({ value, label }) => React.createElement('span', { 'data-orbit': value, 'aria-label': label }),
  '@/components/CourseCover': ({ course }) => React.createElement('img', { alt: course.title || '' }),
  '@/lib/api-client': { apiClient: { get: async () => ({}), put: async () => ({}) } },
};

/** Compiles a TSX/TS component file (and its relative imports) with JSX, resolving the stubs above. */
function compile(relative, cache = new Map()) {
  const file = path.join(ROOT, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = (id) => {
    if (id in stubs) {
      const s = stubs[id];
      return typeof s === 'function' ? { __esModule: true, default: s } : s;
    }
    if (id === '@/lib/plain-text') return loadModule('lib/plain-text.ts');
    if (id.startsWith('./')) {
      const base = path.join(path.dirname(relative), id);
      for (const ext of ['.tsx', '.ts']) if (fs.existsSync(path.join(ROOT, base + ext))) return compile(base + ext, cache);
    }
    return require(id);
  };
  new Function('exports', 'require', 'module', code)(mod.exports, localRequire, mod);
  return mod.exports;
}

const Panels = compile('components/student/dashboard/Panels.tsx');
const PracticePanel = compile('components/student/dashboard/PracticePanel.tsx').default;
const Live = compile('components/student/dashboard/Live.tsx');
const F = compile('components/student/dashboard/format.ts');
const html = (el) => renderToStaticMarkup(el);
const h = React.createElement;

function populated() {
  return {
    generatedAt: NOW.toISOString(),
    student: { firstName: 'Ada' },
    overview: { enrolled: 2, completedCourses: 1, inProgressCourses: 1, notStartedCourses: 0, completedLessons: 3, totalLessons: 5, overallPercent: 60 },
    continue: { courseId: 'c1', courseTitle: 'Forex <i>Basics</i>', lessonId: 'l2', lessonTitle: 'Trends &amp; ranges', reason: 'next_after_last_viewed', percent: 33.33, href: '/courses/c1/lessons/l2', lastStudiedAt: '2026-11-20T10:00:00Z' },
    courses: [
      { courseId: 'c1', title: 'Forex <i>Basics</i>', thumbnail: null, difficulty: 'beginner', category: 'forex', archived: false, status: 'in_progress', percent: 33.33, completedLessons: 1, totalLessons: 3, completedAt: null, lastStudiedAt: '2026-11-20T10:00:00Z', lastLesson: null, href: '/courses/c1/lessons/l2', action: 'continue' },
      { courseId: 'c2', title: 'Pip Maths', thumbnail: null, difficulty: 'beginner', category: 'forex', archived: false, status: 'completed', percent: 100, completedLessons: 2, totalLessons: 2, completedAt: '2026-11-17T10:00:00Z', lastStudiedAt: '2026-11-17T10:00:00Z', lastLesson: null, href: '/courses/c2', action: 'review' },
    ],
    learning: { timezone: 'Africa/Lagos', today: '2026-11-21', todayMinutes: 0, recentMinutes: 45, totalMinutes: 50, recent: [], streak: { current: 2, longest: 3, activeToday: false }, series: { range: '30', granularity: 'day', timezone: 'Africa/Lagos', buckets: [{ key: '2026-11-20', minutes: 30, lessons: 1 }], totals: { minutes: 30, lessons: 1, activeDays: 1 }, undatedCompletions: 1 } },
    assessments: { attempts: 4, scanned: 4, quizzesAttempted: 4, quizzesPassed: 1, passRate: 33.3, averagePercent: 67.5, bestPercent: 100, recent: [{ id: 's1', lessonId: 'l2', courseId: 'c1', lessonTitle: 'Trends', courseTitle: 'Forex Basics', percent: 50, passed: false, attemptNumber: 1, finishedAt: '2026-11-19T10:00:00Z', href: '/courses/c1/lessons/l2' }], trend: [], firstPassedAt: null },
    upcoming: { total: 2, retakes: 1, items: [
      { kind: 'quiz', id: 'quiz:l1', title: 'Quiz · Candles', courseId: 'c1', courseTitle: 'Forex Basics', lessonId: 'l1', lessonTitle: 'Candles', status: 'retake_available', opensAt: null, dueAt: null, attemptsUsed: 1, attemptsRemaining: null, maxAttempts: null, timeLimitMinutes: 10, passingPercent: 70, bestPercent: 40, href: '/courses/c1/lessons/l1' },
      { kind: 'quiz', id: 'quiz:l4', title: 'Quiz · Pips', courseId: 'c2', courseTitle: 'Pip Maths', lessonId: 'l4', lessonTitle: 'Pips', status: 'opens_soon', opensAt: '2026-12-01T00:00:00Z', dueAt: null, href: '/courses/c2/lessons/l4' },
    ] },
    milestones: [{ id: 'first_course_started', title: 'First course started', description: 'Enrolled.', achieved: true, at: '2026-11-01T10:00:00Z' }, { id: 'lessons_10', title: '10 lessons completed', description: 'Ten lessons.', achieved: false, at: null, progress: { current: 3, target: 10 } }],
    certificates: 1,
    recommendations: [{ id: 'resume', kind: 'learn', title: 'Continue Forex <i>Basics</i>', reason: 'Your next lesson is "Trends".', href: '/courses/c1/lessons/l2', action: 'Resume lesson' }],
    activity: { hasMore: false, events: [{ id: 'lesson:l1', type: 'lesson_completed', at: '2026-11-20T09:00:00Z', title: 'Completed "Candles"', detail: 'Forex Basics', href: '/courses/c1/lessons/l1' }] },
    trading: {
      simulated: true,
      marketLabel: 'SIMULATED MARKET — NOT LIVE MARKET DATA',
      hasAccount: true,
      overview: { account: { id: 'a1', virtual: true, currency: 'USD', startingBalance: '10000.00', balance: '10012.34', equity: '10010.00', usedMargin: '36.67', freeMargin: '9973.33', marginLevel: '27297.52', unrealizedPl: '-2.34', marginCall: false, leverage: '1:30' }, openPositions: 1, pendingOrders: 0, positions: [], market: { label: 'SIMULATED', open: true } },
      performance: { closedTrades: 2, wins: 1, losses: 1, breakeven: 0, winRate: '50.00', netRealized: '12.34', grossProfit: '15.00', grossLoss: '-2.66', averageWin: '15.00', averageLoss: '-2.66', bestTrade: '15.00', worstTrade: '-2.66', closeReasons: { manual: 2 }, byInstrument: [], series: [] },
      reviews: { reviewed: 1, pending: 1 },
      recent: [{ id: 'p1', instrument: 'EUR_USD', side: 'buy', units: '1000', entry: '1.10000', stopLoss: '1.09000', takeProfit: null, status: 'closed', currentPrice: null, unrealizedPl: null, exit: '1.10150', realizedPl: '15.00', closeReason: 'take_profit', openedAt: '2026-11-20T08:00:00Z', closedAt: '2026-11-20T09:00:00Z' }],
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering with data
// ---------------------------------------------------------------------------

test('welcome and continue learning: real name, status, resume link to the right lesson', () => {
  const out = html(h(Panels.WelcomeHero, { data: populated() }));
  assert.match(out, /Welcome back, Ada/);
  assert.match(out, /1 course in progress · 1 completed · 3 lessons done\./);
  assert.match(out, /href="\/courses\/c1\/lessons\/l2"[^>]*data-testid="resume-link"/);
  assert.match(out, /2-day<\/span> learning streak · learn today to keep it/);
  assert.match(out, /data-testid="next-action"[^>]*>Next: Resume lesson/);
});

test('titles stored as HTML are shown as plain text, never as markup', () => {
  const out = html(h(Panels.WelcomeHero, { data: populated() })) + html(h(Panels.MyCourses, { courses: populated().courses })) + html(h(Panels.Recommendations, { items: populated().recommendations }));
  assert.ok(!out.includes('<i>'), 'no injected tags');
  assert.match(out, /Continue · Forex Basics/);
  assert.match(out, /Trends &amp; ranges/, 'entities decoded once, then escaped by React');
});

test('my courses: progress, counts, and the right action per status', () => {
  const out = html(h(Panels.MyCourses, { courses: populated().courses }));
  assert.match(out, /data-testid="my-courses"/);
  assert.match(out, /href="\/courses\/c1\/lessons\/l2"[^>]*data-testid="course-action-c1"[^>]*>Continue</);
  assert.match(out, /href="\/courses\/c2"[^>]*data-testid="course-action-c2"[^>]*>Review course</);
  assert.match(out, /1 of 3 lessons/);
  assert.match(out, /aria-valuenow="33"/);
});

test('overview metrics come straight from the overview', () => {
  const d = populated();
  const out = html(h(Panels.OverviewMetrics, { overview: d.overview, minutes: 50, certificates: 1 }));
  assert.match(out, /data-testid="metric-enrolled">2</);
  assert.match(out, /data-testid="metric-lessons">3</);
  assert.match(out, /data-testid="metric-overall">60%</);
  assert.match(out, /data-testid="metric-time">50 min</);
});

test('upcoming assessments: open link for open work, none for work that is not open yet', () => {
  const out = html(h(Panels.UpcomingAssessments, { upcoming: populated().upcoming }));
  assert.match(out, /href="\/courses\/c1\/lessons\/l1"[^>]*data-testid="upcoming-open-quiz:l1"/);
  assert.ok(!out.includes('upcoming-open-quiz:l4'));
  assert.match(out, /Not open yet/);
  assert.match(out, /Retake available/);
  assert.match(out, /10 min/);
});

test('assessment summary, milestones and activity render the server figures', () => {
  const d = populated();
  const a = html(h(Panels.AssessmentSummary, { a: d.assessments, retakes: 1 }));
  assert.match(a, /data-testid="metric-pass-rate">33.3%</);
  assert.match(a, /Not passed/);
  const m = html(h(Panels.Milestones, { items: d.milestones }));
  assert.match(m, /data-testid="milestones-count"><span[^>]*>1<\/span> of 2/);
  assert.match(m, /3\/10/);
  const act = html(h(Panels.ActivityList, { events: d.activity.events, now: NOW }));
  assert.match(act, /href="\/courses\/c1\/lessons\/l1"/);
  assert.match(act, /Forex Basics · yesterday/, "25 hours before the clock");
});

test('practice panel: SIMULATED label, exact strings, realised and unrealised kept apart', () => {
  const out = html(h(PracticePanel, { trading: populated().trading, charts: { performance: h('div', { id: 'chart-perf' }), outcome: h('div', { id: 'chart-out' }), instrument: h('div', { id: 'chart-inst' }) } }));
  assert.match(out, /data-testid="sim-label">SIMULATED MARKET — NOT LIVE MARKET DATA</);
  assert.match(out, /data-testid="fig-balance">10012.34</);
  assert.match(out, /data-testid="fig-unrealized">-2.34</);
  assert.match(out, /data-testid="perf-net">\+12.34</);
  assert.match(out, /data-testid="perf-win-rate">50.00%</);
  assert.match(out, /data-testid="perf-reviewed">1\/2</);
  assert.ok(out.includes('id="chart-perf"') && out.includes('id="chart-inst"'));
  assert.match(out, /Take-profit/);
  assert.match(out, /href="\/student-dashboard"[^>]*>Full history/);
});

// ---------------------------------------------------------------------------
// Empty and loading states (with the real service output)
// ---------------------------------------------------------------------------

test('empty states: every section renders its empty state for a new student (real response)', async () => {
  const d = await A.studentDashboard(memoryDb({}), { userId: '0123456789abcdef01234567', now: NOW, env: {} });
  const out = [
    html(h(Panels.WelcomeHero, { data: d, fallbackName: 'Ada' })),
    html(h(Panels.MyCourses, { courses: d.courses })),
    html(h(Panels.UpcomingAssessments, { upcoming: d.upcoming })),
    html(h(Panels.AssessmentSummary, { a: d.assessments, retakes: d.upcoming.retakes })),
    html(h(Panels.ActivityList, { events: d.activity.events })),
    html(h(PracticePanel, { trading: d.trading })),
  ].join('');
  for (const id of ['continue-empty', 'courses-empty', 'upcoming-empty', 'assessments-empty', 'activity-empty', 'practice-empty']) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.match(out, /Welcome, Ada/);
  assert.match(out, /SIMULATED/, 'the simulated label is shown even with no account');
});

test('learning activity: initial series rendered; empty period says so; range and undated note', () => {
  const Chart = ({ series, metric }) => h('div', { 'data-chart': `${metric}:${series.buckets.length}` });
  const d = populated();
  const out = html(h(Live.LearningActivity, { initial: d.learning.series, Chart }));
  assert.match(out, /data-chart="minutes:1"/);
  assert.match(out, /aria-pressed="true"[^>]*>30 days/);
  assert.match(out, /Days in Africa\/Lagos time\./);
  const empty = html(h(Live.LearningActivity, { initial: { ...d.learning.series, totals: { minutes: 0, lessons: 0, activeDays: 0 } }, Chart }));
  assert.match(empty, /data-testid="learning-empty"/);
});

test('page: loading skeleton, error with retry, client-only charts, responsive layout', () => {
  const page = read('pages/dashboard.tsx');
  assert.match(page, /data-testid="dashboard-loading"/);
  assert.match(page, /data-testid="dashboard-error"/);
  assert.match(page, /onClick=\{\(\) => void refetch\(\)\}/);
  assert.match(page, /Showing what was loaded before\./, 'a failed refresh keeps the data on screen');
  assert.equal((page.match(/ssr: false/g) || []).length, 5, 'every chart is client-only');
  assert.match(page, /lg:grid-cols-\[minmax\(0,1fr\)_20rem\]/, 'overview: two columns on wide screens, one on phones');
  assert.match(page, /overflow-x-auto/, 'the tab bar scrolls on phones');
  assert.match(page, /useStudentDashboard\(isStudent\)/, 'one shared dashboard request');
  assert.ok(!page.includes('dangerouslySetInnerHTML'));
  const hook = read('hooks/useStudentDashboard.ts');
  assert.match(hook, /apiClient\.get<StudentDashboard>\('\/student\/dashboard'\)/);
  assert.match(hook, /useProgressSync/);
});

test('charts plot server data only; fetching parts call the student endpoints', () => {
  const charts = read('components/student/dashboard/Charts.tsx');
  assert.match(charts, /series\.buckets\.map/);
  assert.match(charts, /chartNumber\(p\.cumulative\)/);
  assert.ok(!/Math\.random|interpolat/i.test(charts.replace(/nothing is\s+\* interpolated/, '')), 'no invented points');
  const live = read('components/student/dashboard/Live.tsx');
  assert.match(live, /\/student\/analytics\/learning\?range=\$\{next\}/);
  assert.match(live, /\/student\/analytics\/activity\?page=\$\{page \+ 1\}&limit=10/);
  assert.match(live, /apiClient\.put\('\/notifications', \{ notificationId: id \}\)/, 'existing notification read state');
  assert.match(live, /'\/notifications\?limit=5'/);
});

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

test('format helpers: signs without arithmetic, labels, relative time', () => {
  assert.deepEqual(['12.34', '-0.01', '0.00', '+3.00', null].map(F.signOf), ['up', 'down', 'flat', 'up', 'flat']);
  assert.equal(F.signed('12.34'), '+12.34');
  assert.equal(F.signed('-1.00'), '-1.00');
  assert.equal(F.chartNumber('-2.66'), -2.66);
  assert.equal(F.chartNumber('oops'), 0);
  assert.equal(F.bucketLabel('2026-11-05'), '5 Nov');
  assert.equal(F.bucketLabel('2026-07'), 'Jul 2026');
  assert.equal(F.minutesLabel(135), '2 h 15 min');
  assert.equal(F.relativeTime('2026-11-21T09:30:00Z', NOW), '30 min ago');
  assert.equal(F.relativeTime('2026-11-20T08:00:00Z', NOW), 'yesterday');
  assert.equal(F.relativeTime('2026-11-21T12:00:00Z', NOW), 'in 2 h');
  assert.equal(F.pairLabel('USD_JPY'), 'USD/JPY');
  assert.equal(F.learningStatus({ enrolled: 0, completedCourses: 0, inProgressCourses: 0, completedLessons: 0 }), 'You have not enrolled in a course yet.');
  assert.equal(F.learningStatus({ enrolled: 2, completedCourses: 2, inProgressCourses: 0, completedLessons: 9 }), 'You have completed all 2 of your courses.');
});

// ---------------------------------------------------------------------------
// Overview structure: tabs, limits, disclosures
// ---------------------------------------------------------------------------

test('page structure: four tabs, one panel at a time, synced to ?tab=', () => {
  const page = read('pages/dashboard.tsx');
  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-selected=\{tab === id\}/);
  assert.match(page, /const TABS: Array<\[Tab, string\]> = \[\['overview', 'Overview'\], \['learning', 'Learning'\], \['assessments', 'Assessments'\], \['practice', 'Practice'\]\];/);
  for (const id of ['overview', 'learning', 'assessments', 'practice']) assert.match(page, new RegExp(`\\{tab === '${id}' && \\(\\s*<div role="tabpanel" id="panel-${id}"`), id);
  assert.match(page, /isTab\(router\.query\.tab\) \? router\.query\.tab : 'overview'/, 'unknown ?tab= values fall back to the overview');
  assert.match(page, /shallow: true/, 'switching tabs does not refetch the page');
});

test('overview: short lists, no duplicate Continue, secondary items in disclosures', () => {
  const page = read('pages/dashboard.tsx');
  assert.match(page, /const OVERVIEW_LIMITS = \{ recommendations: 3, upcoming: 3, activity: 4 \};/);
  assert.match(page, /exclude=\{data\.continue \? \['resume', 'unlock'\] : \[\]\}/);
  for (const id of ['more-activity', 'notifications-disclosure', 'reminders-disclosure', 'milestones-disclosure', 'recent-results-disclosure', 'score-trend-disclosure']) assert.ok(page.includes(`testId="${id}"`), id);
  const overview = page.slice(page.indexOf("{tab === 'overview'"), page.indexOf("{tab === 'learning'"));
  for (const heavy of ['MyCourses', 'LearningActivity', 'Milestones items', 'PracticePanel', 'AssessmentSummary']) assert.ok(!overview.includes(heavy), `${heavy} is not on the overview`);
});

test('key figures: four figures from the overview and this week', () => {
  const out = html(h(Panels.KeyFigures, { overview: populated().overview, weekMinutes: 45 }));
  assert.equal((out.match(/<dt /g) || []).length, 4);
  assert.match(out, /data-testid="metric-in-progress">1</);
  assert.match(out, /2 enrolled · 1 completed/);
  assert.match(out, /data-testid="metric-week">45 min</);
});

test('recommendations and upcoming honour the overview limits', () => {
  const recs = [1, 2, 3, 4].map((n) => ({ id: n === 1 ? 'resume' : `r${n}`, kind: 'learn', title: `Rec ${n}`, reason: 'x', href: '/x', action: 'Go' }));
  const out = html(h(Panels.Recommendations, { items: recs, limit: 3, exclude: ['resume'] }));
  assert.ok(!out.includes('Rec 1'), 'Continue is not repeated');
  assert.deepEqual([out.includes('Rec 2'), out.includes('Rec 3'), out.includes('Rec 4')], [true, true, true]);
  const two = html(h(Panels.Recommendations, { items: recs, limit: 2, exclude: ['resume'] }));
  assert.ok(!two.includes('Rec 4'));
  const up = populated().upcoming;
  const limited = html(h(Panels.UpcomingAssessments, { upcoming: up, limit: 1, onViewAll: () => {} }));
  assert.ok(!limited.includes('upcoming-open-quiz:l4') && !limited.includes('Not open yet'));
  assert.match(limited, /data-testid="upcoming-view-all">View all 2 →/);
});

test('disclosure: native details, closed unless asked, content kept in the document', () => {
  const closed = html(h(Panels.Disclosure, { title: 'More', hint: '3 items', testId: 'd' }, h('p', null, 'inside')));
  assert.match(closed, /^<details[^>]*data-testid="d"/);
  assert.ok(!/<details[^>]* open=""/.test(closed));
  assert.match(closed, /<summary[^>]*>.*More.*3 items/);
  assert.match(closed, /<p>inside<\/p>/);
  const open = html(h(Panels.Disclosure, { title: 'More', defaultOpen: true }, 'x'));
  assert.match(open, /<details[^>]* open=""/);
});

test('practice snapshot: four figures, SIMULATED, a way into the Practice tab', () => {
  const out = html(h(Panels.PracticeSnapshot, { trading: populated().trading, onOpen: () => {} }));
  assert.match(out, /Simulated/);
  assert.match(out, /data-testid="snapshot-balance">10012.34</);
  assert.match(out, /50.00%/);
  assert.match(out, /data-testid="practice-snapshot-open"/);
  const none = html(h(Panels.PracticeSnapshot, { trading: { ...populated().trading, hasAccount: false, overview: null, performance: { ...populated().trading.performance, closedTrades: 0 } } }));
  assert.match(none, /href="\/student-dashboard"[^>]*>Open the practice desk/);
});

test('practice tab: recent trades sit in a disclosure; assessments recent results split out', () => {
  const out = html(h(PracticePanel, { trading: populated().trading }));
  assert.match(out, /<details[^>]*data-testid="recent-trades-disclosure"/);
  assert.match(out, /data-testid="recent-trades"/);
  const summary = html(h(Panels.AssessmentSummary, { a: populated().assessments, retakes: 1, showRecent: false }));
  assert.ok(!summary.includes('recent-scores'));
  assert.match(html(h(Panels.RecentScores, { a: populated().assessments })), /data-testid="recent-scores"/);
});

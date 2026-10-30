/**
 * Regression checks for the October 2026 application audit: public course search, leaderboard
 * privacy, session handling on a failed profile refresh, the single-language interface, and the
 * theme system (shared toggle, no forced-light sections, theme-aware charts). No database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const { buildCourseListQuery, SEARCH_MAX_CHARS } = require('../lib/course-list-filter');

test('course search matches the text literally instead of running it as a pattern', () => {
  const query = buildCourseListQuery({ search: '(a+)+$' });
  assert.deepEqual(query.$or, [
    { title: { $regex: '\\(a\\+\\)\\+\\$', $options: 'i' } },
    { description: { $regex: '\\(a\\+\\)\\+\\$', $options: 'i' } },
  ]);
  const re = new RegExp(query.$or[0].title.$regex, 'i');
  assert.ok(re.test('Course about (A+)+$ notation'));
  assert.ok(!re.test('aaaa'));
});

test('course filters accept plain strings only and cap their length', () => {
  assert.deepEqual(buildCourseListQuery({ category: ['a', 'b'], difficulty: { $ne: 'x' }, search: ['x'] }), {});
  assert.deepEqual(buildCourseListQuery({ category: ' basics ', difficulty: 'beginner' }), { category: 'basics', difficulty: 'beginner' });
  const long = buildCourseListQuery({ search: 'x'.repeat(5000) });
  assert.equal(long.$or[0].title.$regex.length, SEARCH_MAX_CHARS);
  assert.deepEqual(buildCourseListQuery(undefined), {});
  assert.match(read('pages/api/courses/index.ts'), /const query = buildCourseListQuery\(req\.query\);/);
  assert.doesNotMatch(read('pages/api/courses/index.ts'), /\$regex: search/);
});

test('leaderboard emails go to administrators only', () => {
  const source = read('pages/api/leaderboard/index.ts');
  assert.match(source, /const showEmail = req\.user\?\.role === 'admin' \|\| req\.user\?\.role === 'superadmin';/);
  assert.doesNotMatch(source, /email: user\??\.email/, 'no ranking row copies the email directly');
  assert.equal((source.match(/email: emailOf\(/g) || []).length, 4, 'all four ranking types use the guard');
});

test('a failed profile refresh signs out only when the session was rejected', () => {
  const source = read('hooks/useAuth.tsx');
  assert.match(source, /\.catch\(\(err: unknown\) => \{[\s\S]{0,160}if \(!cancelled && isUnauthorizedError\(err\)\) logout\(\);/);
});

test('the interface has no language switcher and declares English', () => {
  const header = read('components/Header.tsx');
  for (const gone of ['Languages', 'selectedLanguage', 'handleLanguageChange', 'languageOpen', 'Español']) {
    assert.ok(!header.includes(gone), `${gone} removed`);
  }
  assert.match(read('pages/_document.tsx'), /<Html lang="en"/);
});

test('forgot password asks for an email without exposing server configuration', () => {
  const source = read('pages/forgot-password.tsx');
  assert.doesNotMatch(source, /TWILIO|TERMII|Twilio|Termii|RESEND|Resend|e\.g\. Render/);
  assert.doesNotMatch(source, /check-email-config/, 'the page no longer asks the server how mail is configured');
  assert.match(source, /apiClient\.post<\{ message: string \}>\('\/auth\/forgot-password', \{ email: address \}\)/);
  assert.doesNotMatch(source, /<h2 className="text-white/, 'heading is readable in the light theme');
});

test('every shared layout carries the same theme toggle', () => {
  for (const file of ['components/Header.tsx', 'components/auth/AuthFrame.tsx', 'pages/index.tsx', 'pages/how-it-works.tsx']) {
    assert.match(read(file), /import ThemeToggle from '@\/components\/ThemeToggle';/, file);
    assert.match(read(file), /<ThemeToggle /, file);
  }
  const toggle = read('components/ThemeToggle.tsx');
  assert.match(toggle, /aria-label=\{isDark \? 'Switch to light theme' : 'Switch to dark theme'\}/);
  // Icons follow the pre-paint .dark class, so the first render never shows the wrong one.
  assert.match(toggle, /className="hidden h-5 w-5 dark:block"/);
  assert.match(toggle, /className="block h-5 w-5 dark:hidden"/);
});

test('no section is forced light in the dark theme', () => {
  const files = ['pages/index.tsx', 'pages/how-it-works.tsx', 'components/auth/AuthFrame.tsx', 'components/community/CommunityShell.tsx'];
  for (const file of files) assert.ok(!read(file).includes('theme-light-island'), file);
  const css = read('styles/globals.css');
  assert.ok(!css.includes('theme-light-island'));
  assert.match(css, /\.dark \.theme-section,/);
  assert.match(css, /\.dark :where\(\.text-primary-600, \.text-primary-700\) \{/);
  // A pseudo-element inside :is() would invalidate the whole rule.
  assert.doesNotMatch(css, /:is\([^)]*::placeholder/);
  assert.doesNotMatch(read('components/auth/AuthFrame.tsx'), /BrandLogo variant="dark"/);
});

test('the theme follows the saved choice and other tabs', () => {
  const hook = read('hooks/useTheme.tsx');
  assert.match(hook, /window\.addEventListener\('storage', onStorage\)/);
  assert.match(read('pages/_document.tsx'), /localStorage\.getItem\('theme'\)==='light'/);
});

test('charts take their colours from the theme', () => {
  for (const file of ['components/admin/AdminAnalyticsCharts.tsx', 'pages/instructor/assignments/analytics/[assignmentId].tsx']) {
    const source = read(file);
    assert.match(source, /chartPalette\(/, file);
    assert.doesNotMatch(source, /backgroundColor: '#fff'/, file);
    assert.doesNotMatch(source, /stroke="#e[05]e[0-9a-f]{3}"/i, file);
  }
  const ts = require('typescript');
  const compiled = ts.transpileModule(read('lib/chart-theme.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', compiled)(mod, mod.exports);
  const { CHART_THEME, chartPalette } = mod.exports;
  assert.equal(chartPalette(true), CHART_THEME.dark);
  assert.equal(chartPalette(false).tooltipBg, '#ffffff');
});

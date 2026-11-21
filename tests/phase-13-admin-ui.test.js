/**
 * Phase 13: admin portal UI. Components compiled from source and rendered to static markup with
 * next/link, the router and the shell stubbed; pages checked at the source level. No browser here.
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
  'next/router': { useRouter: () => ({ pathname: '/admin/overview', query: {}, isReady: true, push: async () => true, replace: async () => true }) },
  '@/components/ui/OrbitProgress': () => null,
  '@/components/CourseCover': () => null,
  '@/components/Header': () => null,
  '@/components/Footer': () => null,
  '@/components/Sidebar': () => null,
  '@/components/LoadingSpinner': () => null,
  '@/hooks/useAuth': { useAuth: () => ({ user: { role: 'admin' }, isAuthenticated: true, loading: false }) },
  '@/lib/api-client': { apiClient: { get: async () => ({}), post: async () => ({}), patch: async () => ({}) }, isUnauthorizedError: () => false },
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
    if (id.startsWith('@/components/') || id.startsWith('./')) {
      const base = id.startsWith('./') ? path.join(path.dirname(relative), id) : id.replace('@/', '');
      for (const ext of ['.tsx', '.ts']) if (fs.existsSync(path.join(ROOT, base + ext))) return compile(base + ext, cache);
    }
    return require(id);
  };
  new Function('exports', 'require', 'module', code)(mod.exports, localRequire, mod);
  return mod.exports;
}
const V = compile('components/admin/portal/Views.tsx');
const Shell = compile('components/admin/portal/AdminShell.tsx');
const Confirm = compile('components/admin/portal/ConfirmDialog.tsx').default;

test('money: string formatting with thousands separators, never a float', () => {
  assert.equal(V.money('75000.00'), '₦75,000.00');
  assert.equal(V.money('1234567.5'), '₦1,234,567.50');
  assert.equal(V.money('-0.01'), '-₦0.01');
  assert.equal(V.money('25000.00', 'USD'), 'USD 25,000.00');
  assert.equal(V.money('oops'), 'oops');
  assert.ok(!/Number\(|parseFloat/.test(read('components/admin/portal/Views.tsx').match(/export function money[\s\S]*?\n\}/)[0]));
});

test('navigation: Super Admin areas are not offered to an admin', () => {
  const admin = html(h(Shell.AdminNav, { pathname: '/admin/overview', role: 'admin' }));
  for (const href of ['/admin/payments', '/admin/refunds', '/admin/reconciliation', '/admin/audit']) assert.ok(!admin.includes(`href="${href}"`), href);
  for (const href of ['/admin/overview', '/admin/users', '/admin/courses', '/admin/enrollments', '/admin/reports', '/admin/settings']) assert.ok(admin.includes(`href="${href}"`), href);
  const sa = html(h(Shell.AdminNav, { pathname: '/admin/payments', role: 'superadmin' }));
  assert.match(sa, /href="\/admin\/payments" aria-current="page"/);
  assert.ok(sa.includes('href="/admin/audit"'));
});

test('states: checkout states are labelled honestly, with their meaning', () => {
  assert.equal(V.CHECKOUT_STATE.abandoned.label, 'No payment reported');
  assert.match(V.CHECKOUT_STATE.abandoned.help, /Not a provider failure/);
  const out = html(h(V.StatusChip, { map: V.CHECKOUT_STATE, value: 'stalled' }));
  assert.match(out, /title="A confirmation stopped; reconciliation finishes it\."/);
});

test('alerts and metrics render the server figures', () => {
  assert.match(html(h(V.AlertList, { alerts: [] })), /data-testid="alerts-clear"/);
  const alerts = html(h(V.AlertList, { alerts: [{ id: 'a', severity: 'action', title: '2 accounts waiting', href: '/admin?tab=approvals' }] }));
  assert.match(alerts, /href="\/admin\?tab=approvals"/);
  const f = { currency: 'NGN', paidCount: 3, gross: '75000.00', refunds: '25000.00', refundCount: 1, net: '50000.00', states: { paid: 1, held: 1, confirming: 1, stalled: 1, pending: 1, abandoned: 1, closed: 1 }, openExceptions: 1, held: 1, refundsNeedingAttention: 1 };
  const fin = html(h(V.FinanceMetrics, { f, days: 30 }));
  assert.match(fin, /data-testid="fm-gross">₦75,000\.00</);
  assert.match(fin, /data-testid="fm-net">₦50,000\.00</);
  assert.match(fin, /Pending checkouts are never counted as revenue/);
});

test('confirmation: a reason is required for status changes; the consequence is stated', () => {
  const out = html(h(Confirm, { title: 'Suspend this account?', consequence: 'Signed out everywhere.', confirmLabel: 'Suspend account', requireReason: true, danger: true, onConfirm: async () => null, onClose: () => {} }));
  assert.match(out, /role="dialog" aria-modal="true"/);
  assert.match(out, /Signed out everywhere\./);
  assert.match(out, /Reason \(recorded in the audit log\)/);
  assert.match(out, /<button type="submit" class="btn btn-danger-quiet" disabled="">Suspend account<\/button>/, 'disabled until a reason is given');
});

test('pages: shell, data sources, Super Admin gating, states, no HTML sinks', () => {
  const pages = {
    'pages/admin/overview.tsx': ['/admin/portal/overview', false],
    'pages/admin/users/index.tsx': ['/admin/portal/users?', false],
    'pages/admin/users/[id].tsx': ['/admin/portal/users/', false],
    'pages/admin/courses.tsx': ['/admin/portal/courses?', false],
    'pages/admin/enrollments.tsx': ['/admin/portal/enrollments?', false],
    'pages/admin/payments.tsx': ['/admin/portal/payments?', true],
    'pages/admin/refunds.tsx': ['/admin/portal/refunds?', true],
    'pages/admin/reconciliation.tsx': ['/admin/portal/audit?entityType=reconciliation', true],
    'pages/admin/reports.tsx': ['/admin/portal/reports?', false],
    'pages/admin/audit.tsx': ['/admin/portal/audit?', true],
    'pages/admin/settings.tsx': ['/admin/portal/config', false],
  };
  for (const [file, [endpoint, superOnly]] of Object.entries(pages)) {
    const src = read(file);
    assert.match(src, /<AdminShell/, file);
    assert.ok(src.includes(endpoint), `${file} reads ${endpoint}`);
    assert.equal(/<AdminShell superOnly/.test(src), superOnly, `${file} Super Admin gating`);
    assert.match(src, /ErrorState text=\{[^}]*error\}/, `${file} error state`);
    assert.match(src, /Skeleton/, `${file} loading state`);
    assert.ok(!src.includes('dangerouslySetInnerHTML'), file);
  }
  const detail = read('pages/admin/users/[id].tsx');
  assert.match(detail, /apiClient\.patch\(`\/admin\/users\/\$\{id\}`, \{ action, reason \}\)/, 'the existing audited status route');
  assert.match(detail, /requireReason/);
  assert.match(read('pages/admin/courses.tsx'), /apiClient\.post\(`\/courses\/\$\{action\.course\.courseId\}\/status`, \{ status: action\.to \}\)/);
  assert.match(read('pages/admin/refunds.tsx'), /never issued from this list/);
  assert.match(read('pages/admin/settings.tsx'), /not from this page/);
  const sidebar = read('components/Sidebar.tsx');
  assert.equal((sidebar.match(/\{ href: '\/admin\/overview', label: 'Platform operations', icon: AnalyticsIcon \}/g) || []).length, 2, 'both admin menus');
});

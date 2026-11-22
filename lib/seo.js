'use strict';

/**
 * Search-engine rules (Phase 15). Pure.
 *
 * Public, indexable pages are listed in the sitemap; private areas (dashboards, portals, settings,
 * the API) are disallowed in robots.txt AND served with `X-Robots-Tag: noindex, nofollow`
 * (next.config.js), so a private page is not indexed even when a link to it leaks: robots.txt alone
 * only asks crawlers not to fetch, it does not stop indexing of a known URL.
 */

const PUBLIC_PAGES = Object.freeze(['/', '/courses', '/about', '/how-it-works', '/pricing', '/help', '/support', '/legal', '/privacy', '/terms', '/login', '/signup']);

const PRIVATE_PREFIXES = Object.freeze([
  '/api', '/admin', '/instructor', '/dashboard', '/student-dashboard', '/settings', '/notifications', '/announcements',
  '/progress', '/profile', '/payments', '/certificates', '/badges', '/leaderboard', '/community', '/consultations',
  '/ai-assistant', '/onboarding', '/demo-trading', '/reset-password', '/forgot-password',
]);

const xml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function robotsTxt(origin) {
  const lines = ['User-agent: *', ...PUBLIC_PAGES.map((p) => `Allow: ${p}`), ...PRIVATE_PREFIXES.map((p) => `Disallow: ${p}`)];
  if (origin) lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

/** courses: [{ id, updatedAt? }] (published, public). */
function sitemapXml(origin, courses = [], now = new Date()) {
  const day = (d) => (d ? new Date(d) : now).toISOString().slice(0, 10);
  const urls = [
    ...PUBLIC_PAGES.filter((p) => !['/login', '/signup'].includes(p)).map((p) => ({ loc: `${origin}${p === '/' ? '' : p}` || origin, lastmod: day(now), priority: p === '/' ? '1.0' : p === '/courses' ? '0.9' : '0.5' })),
    ...courses.slice(0, 5000).filter((c) => /^[a-f0-9]{24}$/i.test(String(c.id))).map((c) => ({ loc: `${origin}/courses/${c.id}`, lastmod: day(c.updatedAt), priority: '0.8' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${xml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
}

/** next.config.js header rules: noindex for every private prefix. */
function noindexHeaderRules() {
  return PRIVATE_PREFIXES.flatMap((p) => [p, `${p}/:path*`]).map((source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }));
}

module.exports = { PRIVATE_PREFIXES, PUBLIC_PAGES, noindexHeaderRules, robotsTxt, sitemapXml };

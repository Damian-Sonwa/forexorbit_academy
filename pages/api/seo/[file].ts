/**
 * /robots.txt and /sitemap.xml (Phase 15; served here through rewrites in next.config.js).
 * Built from APP_ORIGIN (the canonical site origin, already required in production). The sitemap
 * lists the public pages and published, public courses only (lib/public-catalog.ts); no private
 * page is ever listed. Cached for an hour.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { loadPublicCatalog } from '@/lib/public-catalog';
import { robotsTxt, sitemapXml } from '@/lib/seo';
import { appOriginConfig } from '@/lib/request-guard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  const config = appOriginConfig(process.env);
  const origin = config.ok && config.origin ? config.origin : null;
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.query.file === 'robots') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(robotsTxt(origin));
  }
  if (req.query.file === 'sitemap') {
    if (!origin) return res.status(404).end();
    let courses: Array<{ id: string }> = [];
    try {
      courses = (await loadPublicCatalog(await getDb())).map((c) => ({ id: c.id }));
    } catch {
      console.error(JSON.stringify({ event: 'sitemap', result: 'catalog_unavailable' }));
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(sitemapXml(origin, courses));
  }
  return res.status(404).end();
}

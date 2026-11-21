/**
 * GET /api/admin/portal/export?type=users|courses|enrollments|payments|refunds|audit&<filters>
 * (Phase 13). A CSV of the same filtered list, after the role check for that type (courses and
 * enrollments: admins; users, payments, refunds and audit: Super Admin), at most 10,000 rows,
 * formula-safe cells, and an audit entry for every export. Private, rate limited (30 per 10 min).
 */
import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { adminExportLimiter, allowRequest } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';
import { buildExport } from '@/lib/admin-portal';

const FILTER_KEYS = ['q', 'role', 'status', 'courseId', 'access', 'state', 'from', 'to', 'instructorId', 'attention', 'entityType', 'action', 'actor'];

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    if (!(await allowRequest(adminExportLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const filters: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const value = req.query[key];
      if (typeof value === 'string' && value) filters[key] = value.slice(0, 80);
    }
    const result = await buildExport(await getDb(), { userId: req.user!.userId, role: req.user!.role, email: req.user!.email }, { type: typeof req.query.type === 'string' ? req.query.type : '', filters });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Export-Rows', String(result.rows));
    if (result.truncated) res.setHeader('X-Export-Truncated', 'true');
    return res.status(200).send(result.csv);
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'adminExport', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(handler, ['admin', 'superadmin']);

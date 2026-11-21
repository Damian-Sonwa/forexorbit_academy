/** GET /api/admin/portal/reports?from=YYYY-MM-DD&to=YYYY-MM-DD  (Phase 13): daily platform figures; finance and grading for the Super Admin only. */
import { adminRoute, q } from '@/lib/admin-route';
import { adminReport } from '@/lib/admin-portal';

export default adminRoute('adminReport', (req, db, member) => adminReport(db, member, { from: q(req.query.from), to: q(req.query.to) }));

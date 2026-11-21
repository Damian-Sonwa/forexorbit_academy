/** GET /api/admin/portal/enrollments?q=&courseId=&status=&access=&page=  (Phase 13): enrollments with entitlements; read-only. Payment references for the Super Admin only. */
import { adminRoute, n, q } from '@/lib/admin-route';
import { adminEnrollments } from '@/lib/admin-portal';

export default adminRoute('adminEnrollments', (req, db, member) => adminEnrollments(db, member, { q: q(req.query.q), courseId: q(req.query.courseId), status: q(req.query.status), access: q(req.query.access), page: n(req.query.page), limit: n(req.query.limit) }));

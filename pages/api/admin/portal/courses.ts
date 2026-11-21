/** GET /api/admin/portal/courses?q=&status=&instructorId=&attention=instructor&page=  (Phase 13): course oversight. Status changes: POST /api/courses/:id/status; reassignment: /api/admin/courses/:id/reassign. */
import { adminRoute, n, q } from '@/lib/admin-route';
import { adminCourses } from '@/lib/admin-portal';

export default adminRoute('adminCourses', (req, db, member) => adminCourses(db, member, { q: q(req.query.q), status: q(req.query.status), instructorId: q(req.query.instructorId), attention: q(req.query.attention), page: n(req.query.page), limit: n(req.query.limit) }));

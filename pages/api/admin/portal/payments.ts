/** GET /api/admin/portal/payments?state=&from=&to=&q=&courseId=&page=  (Phase 13, Super Admin): every checkout with its state and refunds. Read-only. */
import { adminRoute, n, q } from '@/lib/admin-route';
import { adminPayments } from '@/lib/admin-portal';

export default adminRoute('adminPayments', (req, db, member) => adminPayments(db, member, { state: q(req.query.state), from: q(req.query.from), to: q(req.query.to), q: q(req.query.q), courseId: q(req.query.courseId), page: n(req.query.page), limit: n(req.query.limit) }), ['superadmin']);

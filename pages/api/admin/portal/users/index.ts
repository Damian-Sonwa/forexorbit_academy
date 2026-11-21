/** GET /api/admin/portal/users?q=&role=&status=&page=&limit=  (Phase 13): server-paginated user search. */
import { adminRoute, n, q } from '@/lib/admin-route';
import { adminUsers } from '@/lib/admin-portal';

export default adminRoute('adminUsers', (req, db, member) => adminUsers(db, member, { q: q(req.query.q), role: q(req.query.role), status: q(req.query.status), page: n(req.query.page), limit: n(req.query.limit) }));

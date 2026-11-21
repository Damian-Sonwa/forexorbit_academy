/** GET /api/admin/portal/refunds?status=open|processed|failed&page=  (Phase 13, Super Admin): refunds across payments. Actions stay POST /api/admin/refunds[/:id]. */
import { adminRoute, n, q } from '@/lib/admin-route';
import { adminRefunds } from '@/lib/admin-portal';

export default adminRoute('adminRefunds', (req, db, member) => adminRefunds(db, member, { status: q(req.query.status), page: n(req.query.page), limit: n(req.query.limit) }), ['superadmin']);

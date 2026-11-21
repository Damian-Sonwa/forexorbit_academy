/** GET /api/admin/portal/audit?entityType=&action=&actor=&from=&to=&q=&page=  (Phase 13, Super Admin): the append-only audit log, filtered. */
import { adminRoute, n, q } from '@/lib/admin-route';
import { auditPage } from '@/lib/admin-portal';

export default adminRoute('adminAudit', (req, db) => auditPage(db, { entityType: q(req.query.entityType), action: q(req.query.action), actor: q(req.query.actor), from: q(req.query.from), to: q(req.query.to), q: q(req.query.q), page: n(req.query.page), limit: n(req.query.limit) }), ['superadmin']);

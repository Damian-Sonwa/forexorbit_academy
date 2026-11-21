/** GET /api/admin/portal/overview?days=7|30|90|365  (Phase 13): platform metrics, alerts and trend. Finance and recent audit actions for the Super Admin only. */
import { adminRoute, n } from '@/lib/admin-route';
import { adminOverview } from '@/lib/admin-portal';

export default adminRoute('adminOverview', (req, db, member) => adminOverview(db, member, { days: n(req.query.days) }));

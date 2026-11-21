/**
 * GET /api/admin/portal/users/:id  (Phase 13): one account: profile and status, enrollments and
 * learning, owned courses (instructors). Payments, account history and phone for the Super Admin
 * only. Status changes stay PATCH /api/admin/users/:id (Super Admin, reasoned, audited).
 */
import { adminRoute, q } from '@/lib/admin-route';
import { adminUserDetail } from '@/lib/admin-portal';

export default adminRoute('adminUserDetail', (req, db, member) => adminUserDetail(db, member, { userId: q(req.query.id) }));

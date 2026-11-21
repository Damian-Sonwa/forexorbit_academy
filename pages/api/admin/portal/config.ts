/** GET /api/admin/portal/config  (Phase 13): which integrations are configured (never secret values). Read-only: deploy-time settings. */
import { adminRoute } from '@/lib/admin-route';
import { platformConfig } from '@/lib/admin-portal';

export default adminRoute('adminConfig', (_req, _db, member) => platformConfig(member));

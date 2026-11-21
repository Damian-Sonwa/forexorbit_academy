/** GET /api/instructor/overview  (Phase 12): teaching metrics, per-course figures and recent activity, scoped to the member's courses. */
import { instructorRoute } from '@/lib/instructor-route';
import { instructorOverview } from '@/lib/instructor-portal';

export default instructorRoute('instructorOverview', (_req, db, member) => instructorOverview(db, member));

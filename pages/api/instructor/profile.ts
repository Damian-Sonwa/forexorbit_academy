/** GET /api/instructor/profile  (Phase 12): the member's own account (name, email, status) and assigned courses. Edits go through the shared /profile page. */
import { instructorRoute } from '@/lib/instructor-route';
import { instructorProfile } from '@/lib/instructor-portal';

export default instructorRoute('instructorProfile', (_req, db, member) => instructorProfile(db, member));

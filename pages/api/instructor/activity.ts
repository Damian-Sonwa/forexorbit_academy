/**
 * GET /api/instructor/activity?page=&limit=  (Phase 12): the member's grade actions and course
 * reassignments, from the append-only audit log. Finishes any interrupted grade audit first.
 */
import { instructorRoute, wholeNumber } from '@/lib/instructor-route';
import { instructorActivity } from '@/lib/instructor-portal';
import { repairGradeAudits } from '@/lib/academic-operations';

export default instructorRoute('instructorActivity', async (req, db, member) => {
  await repairGradeAudits(db, { limit: 20 });
  return instructorActivity(db, member, { page: wholeNumber(req.query.page), limit: wholeNumber(req.query.limit) });
});

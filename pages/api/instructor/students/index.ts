/** GET /api/instructor/students?courseId=&q=&status=&page=&limit=  (Phase 12): students of the member's courses, paginated. Names only, no contact details. */
import { instructorRoute, queryText, wholeNumber } from '@/lib/instructor-route';
import { instructorStudents } from '@/lib/instructor-portal';

export default instructorRoute('instructorStudents', (req, db, member) => instructorStudents(db, member, {
  courseId: queryText(req.query.courseId) || undefined,
  q: queryText(req.query.q),
  status: queryText(req.query.status),
  page: wholeNumber(req.query.page),
  limit: wholeNumber(req.query.limit),
}));

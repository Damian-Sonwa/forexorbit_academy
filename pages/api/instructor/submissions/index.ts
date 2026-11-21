/** GET /api/instructor/submissions?status=pending|graded|late|all&courseId=&assignmentId=&page=&limit=  (Phase 12): the grading queue of the member's courses. */
import { instructorRoute, queryText, wholeNumber } from '@/lib/instructor-route';
import { instructorSubmissions } from '@/lib/instructor-portal';

export default instructorRoute('instructorSubmissions', (req, db, member) => instructorSubmissions(db, member, {
  status: queryText(req.query.status) || 'pending',
  courseId: queryText(req.query.courseId) || undefined,
  assignmentId: queryText(req.query.assignmentId) || undefined,
  page: wholeNumber(req.query.page),
  limit: wholeNumber(req.query.limit),
}));

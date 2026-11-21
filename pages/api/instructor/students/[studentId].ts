/** GET /api/instructor/students/:studentId?courseId=  (Phase 12): one student's records in the member's courses; 404 for a student outside them. */
import { instructorRoute, queryText } from '@/lib/instructor-route';
import { instructorStudentDetail } from '@/lib/instructor-portal';

export default instructorRoute('instructorStudentDetail', (req, db, member) => instructorStudentDetail(db, member, {
  studentId: queryText(req.query.studentId),
  courseId: queryText(req.query.courseId) || undefined,
}));

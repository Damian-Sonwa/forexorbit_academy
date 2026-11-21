/**
 * GET /api/instructor/submissions/:submissionId  (Phase 12): one submission for review (full work,
 * assignment, grade history); 404 outside the member's courses. Grading itself stays
 * POST /api/assignments/:id/grade.
 */
import { instructorRoute, queryText } from '@/lib/instructor-route';
import { submissionDetail } from '@/lib/instructor-portal';

export default instructorRoute('instructorSubmissionDetail', (req, db, member) => submissionDetail(db, member, { submissionId: queryText(req.query.submissionId) }));

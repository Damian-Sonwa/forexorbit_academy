/**
 * GET /api/student/analytics/activity?page=&limit=  (Phase 11)
 * The student's recent learning and practice events, newest first, paged (at most 20 per page)
 * over the most recent 100. Students only; their own records; read-only.
 */
import { studentAnalyticsRoute, wholeNumber } from '@/lib/student-analytics-route';
import { studentActivity } from '@/lib/student-analytics';

export default studentAnalyticsRoute('studentActivity', async (req, res, db, userId) =>
  res.json(await studentActivity(db, { userId, page: wholeNumber(req.query.page), limit: wholeNumber(req.query.limit) })));

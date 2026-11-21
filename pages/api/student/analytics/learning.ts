/**
 * GET /api/student/analytics/learning?range=7|30|90|all  (Phase 11)
 * Learning minutes and dated lesson completions per day (per month for "all"), in the learning
 * timezone, with every bucket present. Students only; their own records; read-only.
 */
import { queryText, studentAnalyticsRoute } from '@/lib/student-analytics-route';
import { parseRange, studentLearningSeries } from '@/lib/student-analytics';

export default studentAnalyticsRoute('studentLearningSeries', async (req, res, db, userId) =>
  res.json(await studentLearningSeries(db, { userId, range: parseRange(queryText(req.query.range)) })));

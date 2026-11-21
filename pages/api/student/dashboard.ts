/**
 * GET /api/student/dashboard?range=7|30|90|all  (Phase 11)
 * The signed-in student's dashboard in one response (lib/student-analytics.js): overview, continue
 * learning, courses, learning series, assessments, upcoming work, milestones, recommendations,
 * recent activity and practice trading. Students only; read-only; private.
 */
import { ObjectId } from 'mongodb';
import { queryText, studentAnalyticsRoute } from '@/lib/student-analytics-route';
import { parseRange, studentDashboard } from '@/lib/student-analytics';

export default studentAnalyticsRoute('studentDashboard', async (req, res, db, userId) => {
  const user = ObjectId.isValid(userId) ? await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { name: 1 } }) : null;
  const name = user && typeof user.name === 'string' ? user.name : null;
  return res.json(await studentDashboard(db, { userId, name, range: parseRange(queryText(req.query.range)) }));
});

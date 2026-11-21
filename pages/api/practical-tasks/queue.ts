/**
 * GET: the grading queue (staff, scoped). ?filter=pending|graded|returned|all, ?taskId, ?courseId,
 * ?studentId, ?mode=automatic|manual|assisted, ?from, ?to (submission dates), ?page.
 */
import { practicalRoute, queryText, wholeNumber } from '@/lib/practical-route';
import { staffQueue } from '@/lib/practical-tasks';

export default practicalRoute('practicalTaskQueue', {
  GET: {
    handler: async (req, db, member) => staffQueue(db, member, {
      filter: queryText(req.query.filter) || 'pending',
      taskId: queryText(req.query.taskId),
      courseId: queryText(req.query.courseId),
      studentId: queryText(req.query.studentId),
      mode: queryText(req.query.mode),
      from: queryText(req.query.from),
      to: queryText(req.query.to),
      page: wholeNumber(req.query.page),
    }),
  },
});

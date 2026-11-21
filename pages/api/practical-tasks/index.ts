/**
 * Practical trading tasks.
 * GET   students: their assigned tasks with state and summary (?group=todo|waiting|graded|overdue|closed).
 *       staff: tasks of their courses (?status, ?courseId, ?q, ?page).
 * POST  instructors: create a draft task (body: { definition, courseId, lessonId?, resources?, generator? }).
 */
import { practicalRoute, queryText, wholeNumber, bodyOf } from '@/lib/practical-route';
import { saveTask, staffTasks, studentTasks } from '@/lib/practical-tasks';

export default practicalRoute('practicalTasks', {
  GET: {
    handler: async (req, db, member) => (member.role === 'student'
      ? studentTasks(db, member, { group: queryText(req.query.group) })
      : staffTasks(db, member, { status: queryText(req.query.status), courseId: queryText(req.query.courseId), q: queryText(req.query.q), page: wholeNumber(req.query.page) })),
  },
  POST: { handler: async (req, db, member) => saveTask(db, member, { body: bodyOf(req) }) },
});

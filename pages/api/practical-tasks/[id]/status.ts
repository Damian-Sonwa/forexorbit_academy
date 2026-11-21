/** POST: close, reopen or archive a task (instructors). Body: { action: 'close' | 'reopen' | 'archive' }. Audited. */
import { practicalRoute, queryText, bodyOf } from '@/lib/practical-route';
import { changeTaskStatus } from '@/lib/practical-tasks';

export default practicalRoute('practicalTaskStatus', {
  POST: { handler: async (req, db, member) => changeTaskStatus(db, member, { taskId: queryText(req.query.id), action: String(bodyOf(req).action || '') }) },
});

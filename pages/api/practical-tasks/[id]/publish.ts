/**
 * POST: publish a draft or assign it to more students (instructors). Body: { audience: 'course' |
 * 'students', studentIds?, expectedVersion }. Only students actively enrolled in the course can
 * receive it. Additive and idempotent; only new recipients are notified (deduplicated).
 */
import { practicalRoute, queryText, bodyOf } from '@/lib/practical-route';
import { publishTask } from '@/lib/practical-tasks';

export default practicalRoute('practicalTaskPublish', { POST: { handler: async (req, db, member) => publishTask(db, member, { taskId: queryText(req.query.id), body: bodyOf(req) }) } });

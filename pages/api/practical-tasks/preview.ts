/** POST: validate a task definition and return it as students will see it (instructors). Nothing is saved. */
import { practicalRoute, bodyOf } from '@/lib/practical-route';
import { previewDefinition } from '@/lib/practical-tasks';

export default practicalRoute('practicalTaskPreview', { POST: { handler: async (req, _db, member) => previewDefinition(member, bodyOf(req)) } });

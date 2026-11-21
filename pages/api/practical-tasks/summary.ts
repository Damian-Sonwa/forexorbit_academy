/** GET: practical task figures for the instructor home (staff, scoped to their courses). */
import { practicalRoute } from '@/lib/practical-route';
import { staffSummary } from '@/lib/practical-tasks';

export default practicalRoute('practicalTaskSummary', { GET: { handler: async (_req, db, member) => staffSummary(db, member) } });

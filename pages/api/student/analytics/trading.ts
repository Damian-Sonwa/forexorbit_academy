/**
 * GET /api/student/analytics/trading  (Phase 11)
 * Practice trading analytics from the simulator's own records (lib/trading/analytics.js): the active
 * account valued at the latest SIMULATED quote, realised performance over closed positions, by
 * instrument and by day, and recent trades. Read-only: the engine is never run from here.
 */
import { studentAnalyticsRoute } from '@/lib/student-analytics-route';
import { studentTrading } from '@/lib/student-analytics';

export default studentAnalyticsRoute('studentTrading', async (_req, res, db, userId) => res.json(await studentTrading(db, { userId })));

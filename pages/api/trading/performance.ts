/** GET /api/trading/performance  (Phase 10): computed from closed positions across all the student's accounts. */
import { studentTradingRoute } from '@/lib/trading/route';
import { performanceOf } from '@/lib/trading/views';

export default studentTradingRoute({
  GET: async (req, res, db) => res.json(await performanceOf(db, req.user!.userId)),
});

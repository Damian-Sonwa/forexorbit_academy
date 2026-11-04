/** PATCH /api/trading/positions/:id  (Phase 10): moves the stop-loss or take-profit, within the risk limits. */
import { queryText, refused, studentTradingRoute } from '@/lib/trading/route';
import { modifyPosition } from '@/lib/trading/engine';
import { presentPosition } from '@/lib/trading/views';

export default studentTradingRoute({
  PATCH: async (req, res, db) => {
    const result = await modifyPosition(db, { userId: req.user!.userId, positionId: queryText(req.query.id), body: req.body });
    if (!result.ok) return refused(res, result);
    return res.json({ position: presentPosition(result.position, null) });
  },
});

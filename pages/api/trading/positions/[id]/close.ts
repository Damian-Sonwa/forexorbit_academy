/** POST /api/trading/positions/:id/close  (Phase 10): closes the student's own position at the current price. */
import { queryText, refused, studentTradingRoute } from '@/lib/trading/route';
import { closePosition } from '@/lib/trading/engine';
import { presentPosition } from '@/lib/trading/views';

export default studentTradingRoute({
  POST: async (req, res, db) => {
    const result = await closePosition(db, { userId: req.user!.userId, positionId: queryText(req.query.id) });
    if (!result.ok) return refused(res, result);
    return res.json({ position: presentPosition(result.position, null), alreadyClosed: Boolean(result.alreadyClosed) });
  },
});

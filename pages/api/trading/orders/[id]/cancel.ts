/** POST /api/trading/orders/:id/cancel  (Phase 10): the student's own pending order only. */
import { queryText, refused, studentTradingRoute } from '@/lib/trading/route';
import { cancelOrder } from '@/lib/trading/engine';
import { presentOrder } from '@/lib/trading/views';

export default studentTradingRoute({
  POST: async (req, res, db) => {
    const result = await cancelOrder(db, { userId: req.user!.userId, orderId: queryText(req.query.id) });
    if (!result.ok) return refused(res, result);
    return res.json({ order: presentOrder(result.order) });
  },
});

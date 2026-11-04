/**
 * POST /api/trading/account/reset  (Phase 10): once per 30 days, with no open positions. The old
 * account and its history are kept, archived, and still count in performance and rankings.
 */
import { refused, studentTradingRoute } from '@/lib/trading/route';
import { resetAccount } from '@/lib/trading/engine';
import { accountView } from '@/lib/trading/views';

export default studentTradingRoute({
  POST: async (req, res, db) => {
    const result = await resetAccount(db, { userId: req.user!.userId });
    if (!result.ok) return refused(res, result);
    return res.json(await accountView(db, { userId: req.user!.userId }));
  },
});

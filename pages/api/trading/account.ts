/**
 * /api/trading/account  (Phase 10)
 * GET   The student's practice account, open positions, pending orders and market status.
 * POST  Creates the account. The balance is always the server's; nothing in the body is read.
 */
import { studentTradingRoute } from '@/lib/trading/route';
import { ensureAccount } from '@/lib/trading/engine';
import { accountView } from '@/lib/trading/views';

export default studentTradingRoute({
  GET: async (req, res, db) => res.json(await accountView(db, { userId: req.user!.userId })),
  POST: async (req, res, db) => {
    await ensureAccount(db, { userId: req.user!.userId });
    return res.status(201).json(await accountView(db, { userId: req.user!.userId }));
  },
});

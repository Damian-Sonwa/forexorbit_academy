/**
 * /api/trading/orders  (Phase 10)
 * GET   The student's order history, ?page=&limit=.
 * POST  Places an order. Identity, balance and price are the server's: the body gives the order
 *       only. A repeat with the same clientOrderId returns the stored order and does nothing.
 *       An order the rules refuse is recorded and returned with its reason (422).
 */
import { queryText, refused, studentTradingRoute, wholeNumber } from '@/lib/trading/route';
import { placeOrder } from '@/lib/trading/engine';
import { history, presentOrder } from '@/lib/trading/views';

export default studentTradingRoute({
  GET: async (req, res, db) => res.json(await history(db, { userId: req.user!.userId, kind: 'orders', page: wholeNumber(req.query.page), limit: wholeNumber(req.query.limit), accountId: queryText(req.query.accountId) })),
  POST: async (req, res, db) => {
    const result = await placeOrder(db, { userId: req.user!.userId, body: req.body });
    if (!result.ok) return refused(res, result);
    const order = presentOrder(result.order);
    return res.status(order.status === 'rejected' ? 422 : result.repeated ? 200 : 201).json({ order, repeated: Boolean(result.repeated) });
  },
});

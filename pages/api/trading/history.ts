/** GET /api/trading/history?kind=positions|ledger&page=&limit=  (Phase 10): the student's own records. */
import { queryText, studentTradingRoute, wholeNumber } from '@/lib/trading/route';
import { history } from '@/lib/trading/views';

export default studentTradingRoute({
  GET: async (req, res, db) => {
    const kind = queryText(req.query.kind) === 'ledger' ? 'ledger' : 'positions';
    return res.json(await history(db, { userId: req.user!.userId, kind, page: wholeNumber(req.query.page), limit: wholeNumber(req.query.limit), accountId: queryText(req.query.accountId) }));
  },
});

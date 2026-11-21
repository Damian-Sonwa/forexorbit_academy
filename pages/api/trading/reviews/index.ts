/**
 * GET /api/trading/reviews?status=pending|reviewed|all&page=1  (practice desk journal)
 * The student's closed simulator trades, each with its review if written. Trade figures are the
 * server's record; nothing here is typed by the student.
 */
import { queryText, studentTradingRoute, wholeNumber } from '@/lib/trading/route';
import { listReviews } from '@/lib/trading/reviews';

export default studentTradingRoute({
  GET: async (req, res, db) => {
    const status = ['pending', 'reviewed'].includes(queryText(req.query.status)) ? queryText(req.query.status) : 'all';
    return res.json(await listReviews(db, { userId: req.user!.userId, status, page: wholeNumber(req.query.page), limit: wholeNumber(req.query.limit) }));
  },
});

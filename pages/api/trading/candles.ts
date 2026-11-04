/** GET /api/trading/candles?instrument=&timeframe=&count=  (Phase 10): simulated candles, up to the simulated now. */
import { queryText, refused, studentTradingRoute, wholeNumber } from '@/lib/trading/route';
import { candleView } from '@/lib/trading/views';

export default studentTradingRoute({
  GET: async (req, res, db) => {
    const result = await candleView(db, { instrument: queryText(req.query.instrument), timeframe: queryText(req.query.timeframe), count: wholeNumber(req.query.count) });
    if (!result.ok) return refused(res, result);
    const body: Record<string, unknown> = { ...result };
    delete body.ok;
    return res.json(body);
  },
});

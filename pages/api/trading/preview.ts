/**
 * GET /api/trading/preview?type=&instrument=&side=&units=&stopLoss=&takeProfit=&price=  (Phase 10)
 * What an order would need. Reads only; nothing is reserved.
 */
import { previewOrder } from '@/lib/trading/engine';
import { queryText, refused, studentTradingRoute } from '@/lib/trading/route';

export default studentTradingRoute({
  GET: async (req, res, db) => {
    const field = (name: string) => queryText(req.query[name]) || undefined;
    const body = { type: field('type'), instrument: field('instrument'), side: field('side'), units: field('units'), stopLoss: field('stopLoss'), takeProfit: field('takeProfit'), price: field('price') };
    const result = await previewOrder(db, { userId: req.user!.userId, body });
    if (!result.ok) return refused(res, result);
    return res.json({ preview: result.preview });
  },
});

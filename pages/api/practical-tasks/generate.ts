/**
 * POST: generate an editable practical task from template settings (instructors). Nothing is
 * saved. When the simulated market is open, the simulated mid price of the first instrument is added
 * as context; the instructions label it simulated, never live.
 */
import type { Db } from 'mongodb';
import { practicalRoute, bodyOf } from '@/lib/practical-route';
import { previewGenerated } from '@/lib/practical-tasks';
import { marketState, quotesAt } from '@/lib/trading/market-data';
import { formatPrice } from '@/lib/trading/money';

async function simulatedContext(db: Db, instrument: unknown) {
  try {
    if (typeof instrument !== 'string') return null;
    const market = await marketState(db);
    if (!market.open || !market.dataset) return null;
    const { quotes } = await quotesAt(db, market.dataset, [instrument], market.simTime);
    const q = (quotes as Record<string, { bid: bigint; ask: bigint }>)[instrument];
    if (!q) return null;
    return { price: formatPrice((q.bid + q.ask) / 2n) };
  } catch {
    return null;
  }
}

export default practicalRoute('practicalTaskGenerate', {
  POST: {
    handler: async (req, db, member) => {
      const body = bodyOf(req);
      const first = Array.isArray(body.instruments) ? body.instruments[0] : 'EUR_USD';
      const context = member.role === 'instructor' ? await simulatedContext(db, first) : null;
      return previewGenerated(member, body, { context });
    },
  },
});

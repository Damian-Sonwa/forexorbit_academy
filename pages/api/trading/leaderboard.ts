/**
 * /api/trading/leaderboard  (Phase 10)
 * GET  Opted-in students by return: a pseudonym, return, drawdown and trade count, nothing else.
 * PUT  { optIn } joins or leaves. Off by default.
 */
import { refused, studentTradingRoute } from '@/lib/trading/route';
import { leaderboard, setLeaderboardOptIn } from '@/lib/trading/views';

export default studentTradingRoute({
  GET: async (req, res, db) => res.json(await leaderboard(db, { userId: req.user!.userId })),
  PUT: async (req, res, db) => {
    const result = await setLeaderboardOptIn(db, { userId: req.user!.userId, optIn: req.body?.optIn === true });
    if (!result.ok) return refused(res, result);
    return res.json({ leaderboardOptIn: result.leaderboardOptIn });
  },
});

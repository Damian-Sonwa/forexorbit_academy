/**
 * PUT /api/trading/reviews/:positionId  (practice desk journal)
 * Saves the student's reflection on one of their own closed trades. When AI is configured, feedback
 * is generated for a new review or changed text; a failure there never fails the save.
 */
import { queryText, refused, studentTradingRoute } from '@/lib/trading/route';
import { saveReview, setAiFeedback } from '@/lib/trading/reviews';
import { analyzeTradeReview, isAIConfigured } from '@/lib/ai';

export default studentTradingRoute({
  PUT: async (req, res, db) => {
    const positionId = queryText(req.query.positionId);
    const result = await saveReview(db, { userId: req.user!.userId, positionId, body: req.body });
    if (!result.ok) {
      if (result.field) return res.status(result.status).json({ error: result.error, field: result.field });
      return refused(res, result);
    }
    let review = result.review;
    if (result.changedText && isAIConfigured()) {
      try {
        const feedback = await analyzeTradeReview({ trade: result.trade, setup: review.setup, followedPlan: review.followedPlan, confidence: review.confidence, emotion: review.emotion, reason: review.reason, lesson: review.lesson }, req.user!.userId);
        await setAiFeedback(db, positionId, feedback);
        review = { ...review, aiFeedback: feedback };
      } catch {
        console.error(JSON.stringify({ event: 'tradeReviewFeedback', result: 'failed' }));
      }
    }
    return res.status(result.created ? 201 : 200).json({ review, trade: result.trade });
  },
});

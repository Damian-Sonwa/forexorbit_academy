/**
 * POST: report a community question or reply (Phase 14). Body: { targetType: 'question' |
 * 'reply', targetId, reason, details? }. One report per member per post; your own posts cannot
 * be reported. Rate limited per account.
 */
import { communicationRoute, bodyOf } from '@/lib/communication-route';
import { activityLimiter } from '@/lib/content-rate-limit';
import { report } from '@/lib/communication/moderation';

export default communicationRoute('communityReport', { POST: { limiter: activityLimiter, handler: async (req, db, member) => report(db, member, bodyOf(req)) } });

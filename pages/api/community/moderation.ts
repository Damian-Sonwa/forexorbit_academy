/**
 * Community moderation (Phase 14; instructors, Admin, Super Admin).
 * GET   ?status=reported|hidden: the review queue with report reasons and history.
 * POST  { targetType, targetId, action: 'hide' | 'restore' | 'clear', reason }: audited; nothing is
 *       deleted (hidden content is kept as evidence).
 */
import { communicationRoute, bodyOf, queryText } from '@/lib/communication-route';
import { moderate, queue } from '@/lib/communication/moderation';

export default communicationRoute('communityModeration', {
  GET: { handler: async (req, db, member) => queue(db, member, { status: queryText(req.query.status) }) },
  POST: { handler: async (req, db, member) => moderate(db, member, bodyOf(req)) },
}, ['instructor', 'admin', 'superadmin']);

/**
 * Announcements (Phase 14).
 * GET   ?page: announcements addressed to the member (published, not expired).
 *       ?manage=1 (staff): the member's own (admins: all) for the management screen.
 * POST  staff: create a draft { title, body, audience, courseId?, publishAt?, expiresAt?, link? }.
 */
import { communicationRoute, bodyOf, queryText } from '@/lib/communication-route';
import { create, manageable, visibleTo } from '@/lib/communication/announcements';

export default communicationRoute('announcements', {
  GET: {
    handler: async (req, db, member) => (queryText(req.query.manage) === '1'
      ? manageable(db, member, { status: queryText(req.query.status) })
      : visibleTo(db, member, { page: Number(queryText(req.query.page)) || 1 })),
  },
  POST: { handler: async (req, db, member) => create(db, member, bodyOf(req)) },
});

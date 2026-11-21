/**
 * One announcement (Phase 14, staff; instructors their own only).
 * PUT   edit (a published announcement keeps its audience).
 * POST  { action: 'publish' | 'archive' }: publish now (or schedule when publishAt is in the
 *       future; recipients are notified once each) or archive. Audited.
 */
import { communicationRoute, bodyOf, queryText } from '@/lib/communication-route';
import { archive, publish, update } from '@/lib/communication/announcements';

export default communicationRoute('announcement', {
  PUT: { handler: async (req, db, member) => update(db, member, queryText(req.query.id), bodyOf(req)) },
  POST: {
    handler: async (req, db, member) => {
      const action = bodyOf(req).action;
      if (action === 'publish') return publish(db, member, queryText(req.query.id));
      if (action === 'archive') return archive(db, member, queryText(req.query.id));
      return { ok: false, status: 400, error: 'Choose publish or archive.' };
    },
  },
}, ['instructor', 'admin', 'superadmin']);

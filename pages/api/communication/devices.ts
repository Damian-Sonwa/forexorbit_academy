/**
 * Push devices (Phase 14), the signed-in member's own only.
 * GET     devices and whether push is available on this deployment (VAPID configured), with the
 *         public key a browser needs to subscribe.
 * POST    { subscription, label }: registers this browser (removed from any other account).
 * DELETE  ?id=<device id>: removes one of the member's devices.
 */
import { communicationRoute, bodyOf, queryText } from '@/lib/communication-route';
import { listDevices, registerDevice, revokeDevice, vapidConfig } from '@/lib/communication/web-push';

export default communicationRoute('communicationDevices', {
  GET: { handler: async (_req, db, member) => listDevices(db, member) },
  POST: {
    handler: async (req, db, member) => {
      if (!vapidConfig().ok) return { ok: false, status: 503, error: 'Push notifications are not available on this site yet. In-app and email notifications still work.' };
      const body = bodyOf(req);
      return registerDevice(db, member, { subscription: body.subscription, label: body.label, sessionFamilyId: member.sessionFamilyId });
    },
  },
  DELETE: { handler: async (req, db, member) => revokeDevice(db, member, { deviceId: queryText(req.query.id) }) },
});

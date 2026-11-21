/**
 * GET: communication operations (Phase 14; Admin and Super Admin). Delivery counts by state over
 * ?hours (1-168, default 24), queue depth, retries, suppressed addresses, recent terminal failures
 * (type, reason and attempts only: no addresses or contents), push states, socket counters, the
 * last worker run, and which providers are configured (never their secrets).
 */
import { communicationRoute, queryText } from '@/lib/communication-route';
import { deliveryStats } from '@/lib/communication/delivery';
import { snapshot } from '@/lib/communication/metrics';
import { vapidConfig } from '@/lib/communication/web-push';
import { readConfig } from '@/lib/communication/email-sender';

export default communicationRoute('adminCommunication', {
  GET: {
    handler: async (req, db) => {
      const hours = Math.min(168, Math.max(1, Number(queryText(req.query.hours)) || 24));
      const stats = await deliveryStats(db, { windowHours: hours });
      return {
        ok: true,
        ...stats,
        realtime: snapshot(),
        providers: {
          email: readConfig().ok,
          emailWebhook: typeof process.env.RESEND_WEBHOOK_SECRET === 'string' && process.env.RESEND_WEBHOOK_SECRET.startsWith('whsec_'),
          push: vapidConfig().ok,
          video: Boolean((process.env.NEXT_PUBLIC_AGORA_APP_ID || process.env.AGORA_APP_ID) && process.env.AGORA_APP_CERTIFICATE),
        },
      };
    },
  },
}, ['admin', 'superadmin']);

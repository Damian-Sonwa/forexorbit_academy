'use strict';

/**
 * Indexes for the Phase 14 communication queries and the practical tasks (Phase 15).
 * Each one is backed by an explain plan at representative volume (scripts/query-profile.js;
 * docs/audits/phase-15-production-readiness.md, "Index recommendations"). Built only by
 * scripts/communication-indexes.js --apply, which needs separate approval for production.
 *
 * Measured on 60,000 notifications, 400 practical tasks, 3,000 community news items:
 *   C1  email queue (worker every 30 s)        9,601 docs examined -> 25
 *   C2  webhook lookup by provider message id  31,338 -> 1
 *   C3  a student's practical tasks              400 -> 42 (multikey on recipients)
 *   C4  announcements visible to a member      3,000 -> 21
 */

const COMMUNICATION_INDEXES = Object.freeze([
  Object.freeze({ id: 'C1', collection: 'notifications', key: { 'channels.email.state': 1, 'channels.email.nextAttemptAt': 1 }, options: { name: 'comm_email_state_due' }, serves: 'communication worker: due emails (lib/communication/delivery.js processEmailQueue)' }),
  Object.freeze({ id: 'C2', collection: 'notifications', key: { 'channels.email.providerId': 1 }, options: { name: 'comm_email_provider_id', sparse: true }, serves: 'POST /api/webhooks/resend: find the notification for a provider message id' }),
  Object.freeze({ id: 'C3', collection: 'demoTasks', key: { recipients: 1, publishedAt: -1 }, options: { name: 'practical_recipient_recent', partialFilterExpression: { schema: 'practical_v2' } }, serves: 'GET /api/practical-tasks (student): tasks assigned to one student' }),
  Object.freeze({ id: 'C4', collection: 'communityNews', key: { kind: 1, status: 1, publishedAt: -1 }, options: { name: 'announcement_status_recent', partialFilterExpression: { kind: 'announcement' } }, serves: 'GET /api/announcements: published announcements, newest first' }),
]);

module.exports = { COMMUNICATION_INDEXES };

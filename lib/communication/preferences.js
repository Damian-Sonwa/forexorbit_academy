'use strict';

/**
 * Communication preferences and the channel decision (Phase 14). Pure.
 *
 * Every notification has a category. Essential categories (account and security, transactional
 * notices) are always delivered in-app and by email when an address can receive it; users cannot
 * turn them off. Optional categories follow the user's preferences per channel.
 *
 * Preferences live on the user document (`communicationPreferences`), so no collection is added.
 * Missing preferences mean the defaults below; a stored value only ever overrides a default.
 */

const CATEGORIES = Object.freeze({
  account: { label: 'Account and security', essential: true, help: 'Approval, sign-in and security notices. Always sent.' },
  learning: { label: 'Learning and assessments', essential: false, help: 'Assignments, practical tasks, grades and feedback.' },
  consultations: { label: 'Consultations', essential: false, help: 'Booking confirmations, changes and reminders.' },
  announcements: { label: 'Announcements', essential: false, help: 'Notices from the academy and your instructors.' },
  community: { label: 'Community', essential: false, help: 'Replies, mentions and discussion activity.' },
  messages: { label: 'Direct messages', essential: false, help: 'Messages in your conversations.' },
});
const CHANNELS = Object.freeze(['inApp', 'email', 'push']);

/** Defaults: in-app on for everything; email on for what needs attention; push opt-in per device. */
const DEFAULTS = Object.freeze({
  inApp: { account: true, learning: true, consultations: true, announcements: true, community: true, messages: true },
  email: { account: true, learning: true, consultations: true, announcements: true, community: false, messages: false },
  push: { account: true, learning: true, consultations: true, announcements: false, community: false, messages: true },
});

/** Notification type -> category. Unknown types are treated as learning (optional), never essential. */
const TYPE_CATEGORY = Object.freeze({
  task_created: 'learning',
  task_updated: 'learning',
  task_submission: 'learning',
  task_feedback: 'learning',
  task_assignment: 'learning',
  live_class_reminder: 'learning',
  consultation_reminder: 'consultations',
  community_message: 'community',
  instructor_announcement: 'announcements',
  system_alert: 'account',
});

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function categoryOf(notification) {
  const named = notification && typeof notification.category === 'string' ? notification.category : '';
  if (Object.prototype.hasOwnProperty.call(CATEGORIES, named)) return named;
  return TYPE_CATEGORY[notification && notification.type] || 'learning';
}

/** The effective preferences: defaults overlaid with stored booleans; essential always true. */
function effectivePreferences(stored) {
  const out = {};
  for (const channel of CHANNELS) {
    out[channel] = {};
    for (const category of Object.keys(CATEGORIES)) {
      const value = isObj(stored) && isObj(stored[channel]) ? stored[channel][category] : undefined;
      out[channel][category] = CATEGORIES[category].essential ? true : typeof value === 'boolean' ? value : DEFAULTS[channel][category];
    }
  }
  return out;
}

/** Validates an update from the preferences screen. Essential categories cannot be switched off. */
function readPreferencesUpdate(body) {
  const input = isObj(body) ? body : {};
  const out = {};
  for (const channel of CHANNELS) {
    if (input[channel] === undefined) continue;
    if (!isObj(input[channel])) return { ok: false, status: 400, error: `"${channel}" must be an object of categories.` };
    out[channel] = {};
    for (const [category, value] of Object.entries(input[channel])) {
      if (!Object.prototype.hasOwnProperty.call(CATEGORIES, category)) return { ok: false, status: 400, error: `Unknown category "${category}".` };
      if (typeof value !== 'boolean') return { ok: false, status: 400, error: 'Each preference is true or false.' };
      if (CATEGORIES[category].essential && value === false) return { ok: false, status: 400, error: `${CATEGORIES[category].label} messages are essential and cannot be turned off.` };
      if (!CATEGORIES[category].essential) out[channel][category] = value;
    }
  }
  return { ok: true, update: out };
}

/** Whether a channel may carry a notification of this category for this user. */
function allows(stored, category, channel) {
  return effectivePreferences(stored)[channel][category] === true;
}

/** Whether an account may receive anything optional at all (inactive accounts get essentials only). */
const isActiveAccount = (user) => Boolean(user) && (user.status === undefined || user.status === 'approved');

module.exports = { CATEGORIES, CHANNELS, DEFAULTS, TYPE_CATEGORY, allows, categoryOf, effectivePreferences, isActiveAccount, readPreferencesUpdate };

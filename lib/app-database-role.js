/**
 * Database privileges the running app needs (D9). The audit log is append-only: the app user may
 * read and insert there, never update or delete. Everything else the app touches gets
 * find/insert/update/remove on that collection only, so no database-wide write grant is needed.
 */

const ROLE_NAME = 'forexorbitAppRole';

const READ_WRITE_COLLECTIONS = Object.freeze([
  'Screenshots',
  'assignmentSubmissions',
  'assignments',
  'badges',
  'certificateTemplates',
  'certificates',
  'challengeCompletions',
  'challenges',
  'classes',
  'communityMessages',
  'communityNews',
  'communityQuestions',
  'communityReplies',
  'communityRooms',
  'communityVotes',
  'consultationMessages',
  'consultationRequests',
  'consultationSessions',
  'coursePurchases',
  'courses',
  'demoAccounts',
  'demoTaskSubmissions',
  'demoTasks',
  'demoTradeJournal',
  'demoTrades',
  'forumPosts',
  'instructors',
  'lessonPurchases',
  'lessons',
  'messages',
  'notifications',
  'passwordPhoneResets',
  'passwordResetSecurityLogs',
  'paymentExceptions',
  'paystackPaymentIntents',
  'paystackPayments',
  'progress',
  'quizScores',
  'quizzes',
  'rateLimits',
  'reminders',
  'todos',
  'userBadges',
  'userCourseAccess',
  'userLessonAccess',
  'users',
]);

const APPEND_ONLY_COLLECTIONS = Object.freeze(['adminAuditLog']);

/** The admin "seed experts" route creates these collections and their indexes on first use. */
const SETUP_COLLECTIONS = Object.freeze(['consultationMessages', 'consultationRequests', 'consultationSessions']);

const READ_WRITE_ACTIONS = Object.freeze(['find', 'insert', 'update', 'remove']);
const APPEND_ONLY_ACTIONS = Object.freeze(['find', 'insert']);
const SETUP_ACTIONS = Object.freeze(['createCollection', 'createIndex']);
const DATABASE_ACTIONS = Object.freeze(['listCollections']);

/** Actions that would let the app user alter or remove audit entries. */
const AUDIT_FORBIDDEN_ACTIONS = Object.freeze([
  'update',
  'remove',
  'dropCollection',
  'renameCollectionSameDB',
  'collMod',
  'convertToCapped',
  'compact',
  'dropDatabase',
]);

/** Privileges in MongoDB's `createRole` format for database `db`. */
function rolePrivileges(db) {
  return [
    ...READ_WRITE_COLLECTIONS.map((collection) => ({ resource: { db, collection }, actions: [...READ_WRITE_ACTIONS] })),
    ...APPEND_ONLY_COLLECTIONS.map((collection) => ({ resource: { db, collection }, actions: [...APPEND_ONLY_ACTIONS] })),
    ...SETUP_COLLECTIONS.map((collection) => ({ resource: { db, collection }, actions: [...SETUP_ACTIONS] })),
    { resource: { db, collection: '' }, actions: [...DATABASE_ACTIONS] },
  ];
}

function appliesTo(resource, db, collection) {
  if (!resource) return false;
  if (resource.anyResource) return true;
  if (resource.cluster) return false;
  const dbMatches = resource.db === db || resource.db === '';
  const collectionMatches = resource.collection === collection || (resource.collection === '' && !collection.startsWith('system.'));
  return dbMatches && collectionMatches;
}

function actionsOn(privileges, db, collection) {
  const actions = new Set();
  for (const privilege of privileges || []) {
    if (appliesTo(privilege.resource, db, collection)) (privilege.actions || []).forEach((action) => actions.add(action));
  }
  return actions;
}

function resourceLabel(resource) {
  if (!resource) return 'unknown resource';
  if (resource.anyResource) return 'any resource';
  if (resource.cluster) return 'cluster';
  return `${resource.db || '*'}.${resource.collection || '*'}`;
}

/**
 * Every held action the role does not grant on that exact resource: database-wide, other-database,
 * cluster and any-resource grants, and extra actions on app collections.
 */
function excessivePrivileges(privileges, db) {
  const granted = rolePrivileges(db);
  const byLabel = new Map();
  for (const privilege of privileges || []) {
    const resource = privilege.resource || {};
    const allowed = new Set(
      resource.anyResource || resource.cluster
        ? []
        : granted.filter((g) => g.resource.db === resource.db && g.resource.collection === resource.collection).flatMap((g) => g.actions),
    );
    const extra = (privilege.actions || []).filter((action) => !allowed.has(action));
    if (!extra.length) continue;
    const label = resourceLabel(resource);
    const actions = byLabel.get(label) || new Set();
    extra.forEach((action) => actions.add(action));
    byLabel.set(label, actions);
  }
  return [...byLabel].map(([resource, actions]) => ({ resource, actions: [...actions].sort() }));
}

/**
 * Checks a user's effective privileges (from `connectionStatus` with `showPrivileges`) against
 * the role. `ok` needs no write path to the audit log, every action the app uses, and nothing
 * beyond what the role grants.
 */
function evaluatePrivileges(privileges, db) {
  const auditViolations = [];
  for (const collection of APPEND_ONLY_COLLECTIONS) {
    const held = actionsOn(privileges, db, collection);
    const extra = AUDIT_FORBIDDEN_ACTIONS.filter((action) => held.has(action));
    if (extra.length) auditViolations.push({ collection, actions: extra });
  }
  const missing = [];
  const need = (collection, actions) => {
    const held = actionsOn(privileges, db, collection);
    const lacking = actions.filter((action) => !held.has(action));
    if (lacking.length) missing.push({ collection, actions: lacking });
  };
  READ_WRITE_COLLECTIONS.forEach((collection) => need(collection, READ_WRITE_ACTIONS));
  APPEND_ONLY_COLLECTIONS.forEach((collection) => need(collection, APPEND_ONLY_ACTIONS));

  const warnings = [];
  for (const collection of SETUP_COLLECTIONS) {
    const held = actionsOn(privileges, db, collection);
    const lacking = SETUP_ACTIONS.filter((action) => !held.has(action));
    if (lacking.length) warnings.push(`${collection}: ${lacking.join(', ')} (admin "seed experts" route)`);
  }
  const dbHeld = new Set((privileges || []).filter((p) => p.resource && (p.resource.anyResource || ((p.resource.db === db || p.resource.db === '') && p.resource.collection === ''))).flatMap((p) => p.actions || []));
  DATABASE_ACTIONS.filter((action) => !dbHeld.has(action)).forEach((action) => warnings.push(`database: ${action} (admin "seed experts" route)`));

  const excessive = excessivePrivileges(privileges, db);
  return { ok: auditViolations.length === 0 && missing.length === 0 && excessive.length === 0, auditViolations, missing, excessive, warnings };
}

module.exports = {
  APPEND_ONLY_ACTIONS,
  APPEND_ONLY_COLLECTIONS,
  AUDIT_FORBIDDEN_ACTIONS,
  READ_WRITE_ACTIONS,
  READ_WRITE_COLLECTIONS,
  ROLE_NAME,
  SETUP_ACTIONS,
  SETUP_COLLECTIONS,
  evaluatePrivileges,
  excessivePrivileges,
  rolePrivileges,
};

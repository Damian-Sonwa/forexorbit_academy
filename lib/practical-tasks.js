'use strict';

/**
 * Practical trading tasks: the task lifecycle, distribution, attempts, submission and grading.
 *
 * Storage (no new collection, so the app database role is unchanged):
 *   demoTasks             a practical task is a document with schema 'practical_v2'. Older
 *                         free-form demo tasks stay as they are and keep their own routes; every
 *                         older route ignores practical tasks (see lib/practice-desk.js).
 *   demoTaskSubmissions   one document per attempt, _id 'pt:<taskId>:<studentId>:<n>' (unique by
 *                         _id, so a double click cannot make two attempts), schema 'practical_v2'.
 *   adminAuditLog         lifecycle and grade events (append-only).
 *   notifications         through the existing service, with dedupe keys (delivered by the route).
 *   tradingPositions, tradingOrders, tradingAccounts  read only: the evidence. Nothing here
 *                         writes a trading record.
 *
 * Task lifecycle: draft -> published -> closed -> archived (closed can reopen while its deadline is
 * in the future). Publishing distributes to students actively enrolled in the task's course: all
 * of them, or a selection. Distribution is additive and idempotent (recipients are a set; only
 * new recipients are notified, with a dedupe key per task).
 *
 * Attempt lifecycle: in_progress -> submitted -> (graded | awaiting_grading | awaiting_review)
 *   -> graded | returned. A returned attempt allows one more attempt. A further attempt after a
 *   grade is allowed while attempts remain and the deadline has not passed; the latest graded
 *   attempt is the result. Attempts are never overwritten or deleted.
 *
 * Policy freezing. An attempt copies the task's rubric, requirements and grading mode when it
 * starts. Later task edits never change an existing attempt or its grade. A change to the rubric
 * or grading mode after attempts exist needs an explicit confirmation and reason, and is audited.
 *
 * Evidence. On submission the student names their trades (position ids). The server loads them
 * by id AND the student's user id, requires each to have been opened after the attempt started
 * and before submission, refuses a trade already used in another submitted attempt, and freezes
 * the facts (instrument, side, order type, units, entry, stop, target, planned risk, status, exit,
 * result, times, starting balance) from its own records. Client-supplied trade facts are never
 * used. External broker screenshots and figures are kept as student-submitted, unverified
 * evidence and are only ever judged by an instructor.
 *
 * Consistency without transactions: each step is a conditional update on the attempt's current
 * status (and revision for grading), so a repeated or concurrent request either finds the work
 * done or is refused with 409. A submission whose grading step did not run (crash between steps)
 * is finished by finishPending, which every read of the attempt calls.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION } = require('./course-payment');
const { isActiveEnrollment } = require('./enrollment-state');
const { teachingScope } = require('./instructor-portal');
const { safeLinkUrl } = require('./safe-url');
const S = require('./practical-task-spec');
const { generateTask } = require('./practical-task-generator');
const { gradePractical, percentText } = require('./practical-grading');

const C = Object.freeze({
  tasks: 'demoTasks',
  attempts: 'demoTaskSubmissions',
  positions: 'tradingPositions',
  orders: 'tradingOrders',
  accounts: 'tradingAccounts',
  progress: 'progress',
  courses: 'courses',
  lessons: 'lessons',
  users: 'users',
});
const SCHEMA = S.SCHEMA;
const MAX_RECIPIENTS = 1000;
const RETURN_GRACE_MS = 72 * 3600 * 1000;
const PAGE_SIZE = 20;
const MAX_PAGE = 50;
const VERSION_HISTORY = 20;
const ELIGIBLE_TRADES = 50;
const FEEDBACK_MAX = 3000;
const REASON_MIN = 10;
const ATTEMPT_STATUSES = Object.freeze(['in_progress', 'submitted', 'awaiting_grading', 'awaiting_review', 'graded', 'returned']);
const WAITING = Object.freeze(['submitted', 'awaiting_grading', 'awaiting_review']);

const STORED_ID = /^[a-fA-F0-9]{24}$/;
const isId = (v) => typeof v === 'string' && STORED_ID.test(v);
const oid = (v) => new ObjectId(String(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);
const time = (v) => (v ? new Date(v).getTime() || 0 : 0);
const refuse = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
const attemptId = (taskId, studentId, n) => `pt:${taskId}:${studentId}:${n}`;
const isDuplicateKey = (e) => Boolean(e && (e.code === 11000 || /E11000/.test(String(e.message || ''))));
const isStaff = (m) => m && ['instructor', 'admin', 'superadmin'].includes(m.role);
const pageOf = (page, limit) => {
  const size = Math.min(MAX_PAGE, Math.max(1, Number.isInteger(limit) ? limit : PAGE_SIZE));
  const number = Math.max(1, Number.isInteger(page) ? page : 1);
  return { page: number, limit: size, skip: (number - 1) * size };
};
const d = (v) => (v === null || v === undefined ? null : String(v));
const href = { student: (taskId) => `/student-dashboard/practical/${taskId}`, task: (taskId) => `/instructor/practical-tasks/${taskId}`, review: (id) => `/instructor/practical-tasks/review/${encodeURIComponent(id)}` };

function auditEntry({ entityType, entityId, action, actor, reason = '', before = null, after = null, context = {}, now }) {
  return {
    entityType,
    entityId: String(entityId),
    reference: null,
    action,
    reason: reason || '',
    before,
    after,
    outcome: 'saved',
    context,
    actor: { userId: String(actor.userId), email: typeof actor.email === 'string' ? actor.email : null, role: actor.role || null },
    createdAt: now,
  };
}
async function audit(db, entry) {
  try {
    await db.collection(AUDIT_COLLECTION).insertOne(entry);
    return true;
  } catch {
    console.error(JSON.stringify({ event: 'practicalTaskAudit', action: entry.action, result: 'write_failed' }));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** The task if this member may manage it (instructor: course in their scope; admins: read only). */
async function taskForStaff(db, member, taskId, { write = false } = {}) {
  if (!isStaff(member)) return refuse(403, 'Not authorized');
  if (write && member.role !== 'instructor') return refuse(403, 'Only the course instructor can change practical tasks.');
  if (!isId(taskId)) return refuse(404, 'Task not found');
  const task = await db.collection(C.tasks).findOne({ _id: oid(taskId), schema: SCHEMA });
  if (!task) return refuse(404, 'Task not found');
  if (member.role === 'instructor') {
    // The course decides: a reassigned course takes its tasks to the new instructor.
    const scope = await teachingScope(db, member, { courseId: task.courseId });
    if (!scope.ok) return refuse(404, 'Task not found');
    return { ok: true, task, course: scope.courses[0] };
  }
  const course = isId(String(task.courseId || '')) ? await db.collection(C.courses).findOne({ _id: oid(task.courseId) }, { projection: { title: 1, instructorId: 1 } }) : null;
  return { ok: true, task, course, readOnly: true };
}

/** A task visible to this student: published or closed, and the student is a recipient. */
async function taskForStudent(db, member, taskId) {
  if (!member || member.role !== 'student') return refuse(403, 'Only students can open practical tasks.');
  if (!isId(taskId)) return refuse(404, 'Task not found');
  const task = await db.collection(C.tasks).findOne({ _id: oid(taskId), schema: SCHEMA, recipients: { $in: [String(member.userId)] }, status: { $in: ['published', 'closed'] } });
  return task ? { ok: true, task } : refuse(404, 'Task not found');
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

function readResources(list) {
  if (list === undefined || list === null) return { ok: true, resources: [] };
  if (!Array.isArray(list) || list.length > 8) return refuse(400, 'Add at most eight resources.', { field: 'resources' });
  const resources = [];
  for (const item of list) {
    const label = S.cleanText(item && item.label, 120);
    const url = safeLinkUrl(item && item.url);
    if (!label || !url) return refuse(400, 'Each resource needs a name and an http(s) link.', { field: 'resources' });
    resources.push({ label, url });
  }
  return { ok: true, resources };
}

async function checkCourseAndLesson(db, member, courseId, lessonId) {
  if (!isId(courseId)) return refuse(400, 'Choose one of your courses.', { field: 'courseId' });
  const scope = await teachingScope(db, member, { courseId });
  if (!scope.ok) return refuse(400, 'Choose one of your courses.', { field: 'courseId' });
  let lesson = null;
  if (lessonId) {
    if (!isId(lessonId)) return refuse(400, 'That lesson is not in the course.', { field: 'lessonId' });
    lesson = await db.collection(C.lessons).findOne({ _id: oid(lessonId), courseId: { $in: [courseId, oid(courseId)] } }, { projection: { title: 1 } });
    if (!lesson) return refuse(400, 'That lesson is not in the course.', { field: 'lessonId' });
  }
  return { ok: true, course: scope.courses[0], lesson };
}

/** Generator preview: no write. Adds a simulated quote as context when the market is open. */
async function previewGenerated(member, params, { now = new Date(), context = null } = {}) {
  if (!member || member.role !== 'instructor') return refuse(403, 'Only instructors can generate practical tasks.');
  const result = generateTask(params || {}, { now, context });
  if (!result.ok) return result;
  return { ok: true, draft: result.draft, task: presentStaffTask({ ...result.task, _id: 'preview', status: 'draft', rubric: result.task.rubric }), notice: result.notice, generator: result.generator };
}

/** Validates a definition and shows it as students will see it. No write. */
function previewDefinition(member, body = {}, { now = new Date() } = {}) {
  if (!member || member.role !== 'instructor') return refuse(403, 'Only instructors can preview practical tasks.');
  const checked = S.readTaskDefinition(body.definition, { now });
  if (!checked.ok) return checked;
  const view = presentStaffTask({ ...checked.task, _id: 'preview', status: 'draft' });
  return { ok: true, task: view, blocks: S.formatBlocks(checked.task.instructions) };
}

function policyChanged(before, after) {
  const changed = [];
  if (JSON.stringify(before.rubric.criteria) !== JSON.stringify(after.rubric.criteria)) changed.push('rubric');
  if (before.gradingMode !== after.gradingMode) changed.push('gradingMode');
  const reqA = { ...before.requirements, dueAt: null };
  const reqB = { ...after.requirements, dueAt: null };
  if (JSON.stringify(reqA) !== JSON.stringify(reqB)) changed.push('requirements');
  if (before.maxAttempts !== after.maxAttempts) changed.push('maxAttempts');
  if (time(before.dueAt) !== time(after.dueAt)) changed.push('dueAt');
  return changed;
}

/**
 * Creates a draft or saves changes. Body: { definition, courseId, lessonId?, resources?,
 * generator?, expectedVersion? (required for an existing task), confirmPolicyChange?, reason? }.
 */
async function saveTask(db, member, { taskId, body = {}, now = new Date() }) {
  if (!member || member.role !== 'instructor') return refuse(403, 'Only instructors can create practical tasks.');
  let found = null;
  if (taskId) {
    found = await taskForStaff(db, member, taskId, { write: true });
    if (!found.ok) return found;
  }
  // An unchanged deadline is not re-checked against the clock (a task can be edited near it).
  const sameDue = found && body.definition && typeof body.definition === 'object' && time(body.definition.dueAt) === time(found.task.dueAt);
  const checked = S.readTaskDefinition(body.definition, { now: sameDue ? new Date(0) : now });
  if (!checked.ok) return checked;
  const resources = readResources(body.resources);
  if (!resources.ok) return resources;
  const place = await checkCourseAndLesson(db, member, body.courseId, body.lessonId || null);
  if (!place.ok) return place;
  const generator = body.generator && typeof body.generator === 'object' ? { category: S.cleanText(body.generator.category, 40), seed: S.cleanText(String(body.generator.seed ?? ''), 40) } : null;
  const fields = { ...checked.task, courseId: String(body.courseId), lessonId: body.lessonId ? String(body.lessonId) : null, resources: resources.resources };

  if (!taskId) {
    const doc = {
      _id: new ObjectId(),
      ...fields,
      ownerId: String(member.userId),
      assignedBy: String(member.userId),
      // Never null: older "all students" queries match assignedTo null or missing.
      assignedTo: SCHEMA,
      status: 'draft',
      version: 1,
      versions: [{ version: 1, at: now, by: String(member.userId), changes: ['created'], rubricVersion: 1 }],
      recipients: [],
      source: generator ? 'generated' : 'manual',
      generator,
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection(C.tasks).insertOne(doc);
    const id = String(result.insertedId);
    await audit(db, auditEntry({ entityType: 'practical_task', entityId: id, action: 'practical_task_created', actor: member, after: { title: doc.title, gradingMode: doc.gradingMode, source: doc.source }, context: { courseId: doc.courseId }, now }));
    return { ok: true, status: 201, task: presentStaffTask({ ...doc, _id: id }) };
  }

  const task = found.task;
  if (task.status === 'archived') return refuse(409, 'An archived task cannot be edited.');
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== task.version) return refuse(409, 'This task was changed elsewhere. Reload it before saving.', { code: 'stale_version' });
  if (task.status !== 'draft' && String(fields.courseId) !== String(task.courseId)) return refuse(409, 'A published task cannot move to another course.');
  const changes = policyChanged(task, fields);
  const attempts = await db.collection(C.attempts).countDocuments({ taskId: String(task._id), schema: SCHEMA });
  const policyOnly = changes.filter((c) => c !== 'dueAt');
  let reason = '';
  if (attempts > 0 && policyOnly.length) {
    reason = S.cleanText(body.reason, 500) || '';
    if (body.confirmPolicyChange !== true || reason.length < REASON_MIN) {
      return refuse(409, `Students have already started this task. Changing the ${policyOnly.join(', ')} affects only new attempts; existing attempts keep their rules and grades. Confirm the change and give a reason (at least ${REASON_MIN} characters).`, { code: 'policy_change_needs_confirmation', changes: policyOnly });
    }
  }
  const rubricVersion = changes.includes('rubric') ? task.rubric.version + 1 : task.rubric.version;
  const next = { ...fields, rubric: { ...fields.rubric, version: rubricVersion } };
  const version = task.version + 1;
  const history = [...(task.versions || []), { version, at: now, by: String(member.userId), changes: changes.length ? changes : ['content'], rubricVersion, reason: reason || undefined }].slice(-VERSION_HISTORY);
  const won = await db.collection(C.tasks).updateOne({ _id: task._id, version: task.version }, { $set: { ...next, version, versions: history, updatedAt: now } });
  if (!won.matchedCount) return refuse(409, 'This task was changed elsewhere. Reload it before saving.', { code: 'stale_version' });
  if (attempts > 0 && policyOnly.length) {
    await audit(db, auditEntry({ entityType: 'practical_task', entityId: task._id, action: 'practical_task_policy_changed', actor: member, reason, before: Object.fromEntries(policyOnly.map((k) => [k, k === 'rubric' ? { version: task.rubric.version, maxScore: task.rubric.maxScore } : task[k]])), after: Object.fromEntries(policyOnly.map((k) => [k, k === 'rubric' ? { version: rubricVersion, maxScore: next.rubric.maxScore } : next[k]])), context: { courseId: task.courseId, attempts }, now }));
  }
  return { ok: true, task: presentStaffTask({ ...task, ...next, version, versions: history }) };
}

/** Discards a draft that was never published. */
async function discardDraft(db, member, { taskId, now = new Date() }) {
  const found = await taskForStaff(db, member, taskId, { write: true });
  if (!found.ok) return found;
  if (found.task.status !== 'draft' || found.task.publishedAt) return refuse(409, 'Only an unpublished draft can be discarded. Close or archive a published task instead.');
  const done = await db.collection(C.tasks).deleteOne({ _id: found.task._id, status: 'draft' });
  if (done.deletedCount) await audit(db, auditEntry({ entityType: 'practical_task', entityId: found.task._id, action: 'practical_task_discarded', actor: member, before: { title: found.task.title }, now }));
  return { ok: true };
}

/** Students actively enrolled in the course (string ids). */
async function enrolledStudents(db, courseId) {
  const rows = await db.collection(C.progress).find({ courseId: { $in: [String(courseId), oid(courseId)] } }, { projection: { userId: 1, courseId: 1, active: 1, withdrawnAt: 1, progress: 1, completedAt: 1 } }).toArray();
  const ids = [...new Set(rows.filter(isActiveEnrollment).map((r) => String(r.userId)).filter(isId))];
  if (!ids.length) return [];
  const users = await db.collection(C.users).find({ _id: { $in: ids.map(oid) }, role: 'student' }, { projection: { name: 1, status: 1 } }).toArray();
  return users.filter((u) => u.status === undefined || u.status === 'approved').map((u) => ({ id: String(u._id), name: u.name || 'Student' }));
}

/**
 * Publishes (first time) or distributes further. Body: { audience: 'course' | 'students',
 * studentIds?: string[], expectedVersion }. Returns the new recipients and the notification to
 * deliver ({ userIds, ... }) for the route.
 */
async function publishTask(db, member, { taskId, body = {}, now = new Date() }) {
  const found = await taskForStaff(db, member, taskId, { write: true });
  if (!found.ok) return found;
  const task = found.task;
  if (!['draft', 'published'].includes(task.status)) return refuse(409, task.status === 'closed' ? 'Reopen the task before assigning more students.' : 'An archived task cannot be assigned.');
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== task.version) return refuse(409, 'This task was changed elsewhere. Reload it before publishing.', { code: 'stale_version' });
  const recheck = S.readTaskDefinition({ ...task, dueAt: task.dueAt }, { now: task.publishedAt ? new Date(0) : now });
  if (!recheck.ok) return refuse(400, `The task cannot be published yet: ${recheck.error}`, { field: recheck.field });
  if (task.dueAt && time(task.dueAt) <= now.getTime()) return refuse(400, 'The deadline has passed. Set a new deadline before assigning.');
  const eligible = await enrolledStudents(db, task.courseId);
  const eligibleIds = new Set(eligible.map((s) => s.id));
  let chosen;
  if (body.audience === 'students') {
    const ids = Array.isArray(body.studentIds) ? [...new Set(body.studentIds.map(String))] : [];
    if (!ids.length) return refuse(400, 'Choose at least one student.', { field: 'studentIds' });
    if (ids.length > MAX_RECIPIENTS) return refuse(400, `Choose at most ${MAX_RECIPIENTS} students.`);
    const outside = ids.filter((id) => !eligibleIds.has(id));
    if (outside.length) return refuse(400, `${outside.length} of the chosen students are not actively enrolled in this course.`, { field: 'studentIds' });
    chosen = ids;
  } else if (body.audience === 'course') {
    chosen = [...eligibleIds];
  } else {
    return refuse(400, 'Choose who receives the task: the whole course or selected students.', { field: 'audience' });
  }
  if (!chosen.length) return refuse(400, 'No students are actively enrolled in this course yet.');
  const existing = new Set((task.recipients || []).map(String));
  const added = chosen.filter((id) => !existing.has(id));
  const recipients = [...existing, ...added];
  if (recipients.length > MAX_RECIPIENTS) return refuse(400, `A task can have at most ${MAX_RECIPIENTS} students.`);
  const first = task.status === 'draft';
  const set = { recipients, updatedAt: now, version: task.version + 1, lastDistributedAt: now };
  if (first) Object.assign(set, { status: 'published', publishedAt: now, audience: body.audience });
  const won = await db.collection(C.tasks).updateOne({ _id: task._id, version: task.version }, { $set: set });
  if (!won.matchedCount) return refuse(409, 'This task was changed elsewhere. Reload it before publishing.', { code: 'stale_version' });
  await audit(db, auditEntry({ entityType: 'practical_task', entityId: task._id, action: first ? 'practical_task_published' : 'practical_task_distributed', actor: member, after: { added: added.length, recipients: recipients.length, gradingMode: task.gradingMode, audience: body.audience }, context: { courseId: task.courseId }, now }));
  const notify = added.length ? {
    userIds: added,
    type: 'task_created',
    title: 'New practical trading task',
    message: `${task.title}${task.dueAt ? ` · due ${new Date(task.dueAt).toUTCString().slice(0, 22)} UTC` : ''}`,
    roleTarget: 'student',
    taskId: String(task._id),
    dedupeKey: `practical-task:${String(task._id)}`,
    metadata: { href: href.student(String(task._id)), taskTitle: task.title },
  } : null;
  return { ok: true, added: added.length, recipients: recipients.length, task: presentStaffTask({ ...task, ...set }), notify };
}

/** close | reopen | archive. */
async function changeTaskStatus(db, member, { taskId, action, now = new Date() }) {
  const found = await taskForStaff(db, member, taskId, { write: true });
  if (!found.ok) return found;
  const task = found.task;
  const rules = {
    close: { from: ['published'], to: 'closed', field: 'closedAt' },
    reopen: { from: ['closed'], to: 'published', field: 'reopenedAt' },
    archive: { from: ['closed', 'draft'], to: 'archived', field: 'archivedAt' },
  };
  const rule = rules[action];
  if (!rule) return refuse(400, 'Unknown action.');
  if (!rule.from.includes(task.status)) return refuse(409, `A ${task.status} task cannot be ${action === 'reopen' ? 'reopened' : `${action}d`}.`);
  if (action === 'reopen' && task.dueAt && time(task.dueAt) <= now.getTime()) return refuse(409, 'The deadline has passed. Extend it before reopening.');
  if (action === 'archive' && task.status === 'draft' && !task.publishedAt) return refuse(409, 'Discard an unpublished draft instead of archiving it.');
  const won = await db.collection(C.tasks).updateOne({ _id: task._id, status: task.status }, { $set: { status: rule.to, [rule.field]: now, updatedAt: now }, $inc: { version: 1 } });
  if (!won.matchedCount) return refuse(409, 'This task was changed elsewhere. Reload it.');
  await audit(db, auditEntry({ entityType: 'practical_task', entityId: task._id, action: `practical_task_${rule.to === 'published' ? 'reopened' : rule.to}`, actor: member, before: { status: task.status }, after: { status: rule.to }, context: { courseId: task.courseId }, now }));
  return { ok: true, taskStatus: rule.to };
}

// ---------------------------------------------------------------------------
// Presenting
// ---------------------------------------------------------------------------

function presentStaffTask(task) {
  return {
    ...S.presentTaskForStudent(task),
    lessonId: task.lessonId || null,
    resources: task.resources || [],
    version: task.version || 1,
    versions: (task.versions || []).map((v) => ({ version: v.version, at: iso(v.at), changes: v.changes || [], rubricVersion: v.rubricVersion || 1, reason: v.reason || null })),
    recipients: (task.recipients || []).length,
    audience: task.audience || null,
    source: task.source || 'manual',
    generator: task.generator || null,
    rubric: task.rubric,
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
    closedAt: iso(task.closedAt),
  };
}

/** Student-facing state of one task from their attempts (latest last). */
function studentState(task, attempts, now = new Date()) {
  const latest = attempts[attempts.length - 1] || null;
  const submitted = attempts.filter((a) => a.status !== 'in_progress').length;
  const graded = [...attempts].reverse().find((a) => a.status === 'graded') || null;
  const due = task.dueAt ? time(task.dueAt) : null;
  const pastDue = due !== null && now.getTime() > due;
  const open = task.status === 'published';
  const grace = latest && latest.status === 'returned' ? Math.max(due || 0, time(latest.returnedAt) + RETURN_GRACE_MS) : null;
  let state;
  if (!latest) state = !open ? 'closed' : pastDue ? 'overdue' : 'not_started';
  else if (latest.status === 'in_progress') state = !open ? 'closed' : now.getTime() > (latest.graceUntil ? time(latest.graceUntil) : due ?? Infinity) ? 'overdue' : 'in_progress';
  else if (WAITING.includes(latest.status)) state = 'awaiting_grading';
  else if (latest.status === 'returned') state = !open || now.getTime() > grace ? 'closed' : 'returned';
  else state = 'graded';
  const canResubmitAfterGrade = latest && latest.status === 'graded' && open && !pastDue && submitted < task.maxAttempts;
  const canStart = open && ((!latest && !pastDue) || (latest && latest.status === 'returned' && now.getTime() <= grace) || canResubmitAfterGrade);
  return { state, attemptsUsed: submitted, attemptsLeft: Math.max(0, task.maxAttempts - submitted), canStart: Boolean(canStart), latestStatus: latest ? latest.status : null, result: graded && graded.grade ? { score: graded.grade.score, maxScore: graded.grade.maxScore, percent: graded.grade.percent, attempt: graded.attempt } : null, deadline: grace ? iso(grace) : iso(task.dueAt) };
}

function presentTrade(p, order) {
  return {
    positionId: String(p._id),
    instrument: p.instrument,
    side: p.side,
    units: p.units,
    orderType: order ? order.type : null,
    entry: d(p.entry),
    stopLoss: d(order && order.stopLoss !== undefined ? order.stopLoss : p.stopLoss),
    takeProfit: d(order && order.takeProfit !== undefined ? order.takeProfit : p.takeProfit),
    plannedRisk: d(p.plannedRisk),
    status: p.status,
    exit: d(p.exit),
    realizedPl: d(p.realizedPl),
    closeReason: p.closeReason || null,
    openedAt: iso(p.openedAt),
    closedAt: iso(p.closedAt),
  };
}

/** What the student sees of an attempt. Before a result is published: no automated findings. */
function presentAttemptForStudent(a) {
  const published = a.status === 'graded' || a.status === 'returned';
  return {
    id: a._id,
    attempt: a.attempt,
    status: a.status,
    gradingMode: a.gradingMode,
    rubricVersion: a.rubric ? a.rubric.version : 1,
    startedAt: iso(a.startedAt),
    submittedAt: iso(a.submittedAt),
    gradedAt: iso(a.gradedAt),
    returnedAt: iso(a.returnedAt),
    resubmission: Boolean(a.resubmission),
    draft: a.status === 'in_progress' ? { positionIds: (a.draft && a.draft.positionIds) || [], explanation: (a.draft && a.draft.explanation) || '', external: (a.draft && a.draft.external) || null } : null,
    explanation: a.explanation || null,
    external: a.external || null,
    trades: a.evidence ? a.evidence.trades : [],
    attachments: (a.attachments || []).map((f, i) => ({ id: f.id, name: f.name || `Evidence ${i + 1}`, format: f.format || null, bytes: f.bytes || null, url: `/api/practical-tasks/evidence?attempt=${encodeURIComponent(a._id)}&file=${encodeURIComponent(f.id)}` })),
    result: published && a.grade ? presentGrade(a) : null,
  };
}

function presentGrade(a) {
  const g = a.grade;
  const auto = a.autoResult || null;
  return {
    score: g.score,
    maxScore: g.maxScore,
    percent: g.percent,
    source: g.source,
    publishedAt: iso(g.publishedAt),
    criteria: (a.rubric ? a.rubric.criteria : []).map((c) => {
      const mine = (g.criteria || []).find((x) => x.id === c.id) || {};
      const found = auto && c.kind === 'auto' ? auto.criteria.find((x) => x.id === c.id) : null;
      return { id: c.id, label: c.label, kind: c.kind, description: c.description, points: c.points, score: typeof mine.score === 'number' ? mine.score : null, feedback: mine.feedback || null, automated: found ? { score: found.score, status: found.status, detail: found.detail } : null, adjusted: Boolean(found && typeof mine.score === 'number' && found.score !== null && mine.score !== found.score) };
    }),
    feedback: g.feedback || null,
    strengths: auto ? auto.strengths : [],
    recommendations: auto ? auto.recommendations : [],
    observations: auto ? auto.observations : { risk: [], execution: [] },
    automatedVersion: auto ? `${auto.engine} ${auto.version}` : null,
  };
}

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------

async function attemptsOf(db, taskIds, studentId) {
  if (!taskIds.length) return new Map();
  const rows = await db.collection(C.attempts).find({ schema: SCHEMA, studentId: String(studentId), taskId: { $in: taskIds.map(String) } }).sort({ attempt: 1 }).limit(taskIds.length * 12).toArray();
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.taskId)) map.set(r.taskId, []);
    map.get(r.taskId).push(r);
  }
  for (const list of map.values()) list.sort((a, b) => a.attempt - b.attempt);
  return map;
}

const STUDENT_GROUPS = Object.freeze({ todo: ['not_started', 'in_progress', 'returned'], waiting: ['awaiting_grading'], graded: ['graded'], overdue: ['overdue'], closed: ['closed'] });

/** The student's practical tasks with their state, newest first, plus counts per group. */
async function studentTasks(db, member, { group = '', now = new Date() } = {}) {
  if (!member || member.role !== 'student') return refuse(403, 'Only students have practical tasks.');
  const userId = String(member.userId);
  const tasks = await db.collection(C.tasks).find({ schema: SCHEMA, recipients: { $in: [userId] }, status: { $in: ['published', 'closed'] } }).sort({ publishedAt: -1 }).limit(200).toArray();
  const attempts = await attemptsOf(db, tasks.map((t) => String(t._id)), userId);
  for (const t of tasks) for (const a of attempts.get(String(t._id)) || []) await finishPending(db, a, t, now);
  const owners = await names(db, tasks.map((t) => t.ownerId));
  const courseIds = [...new Set(tasks.map((t) => t.courseId).filter(isId))];
  const courses = courseIds.length ? await db.collection(C.courses).find({ _id: { $in: courseIds.map(oid) } }, { projection: { title: 1 } }).toArray() : [];
  const courseTitle = new Map(courses.map((c) => [String(c._id), c.title]));
  const rows = tasks.map((t) => {
    const st = studentState(t, attempts.get(String(t._id)) || [], now);
    return {
      id: String(t._id),
      title: t.title,
      summary: t.summary || '',
      instructor: owners.get(String(t.ownerId)) || 'Instructor',
      course: courseTitle.get(String(t.courseId)) || null,
      category: S.CATEGORIES[t.category] ? S.CATEGORIES[t.category].label : t.category,
      competency: t.competency,
      difficulty: t.difficulty,
      instruments: t.instruments,
      dueAt: st.deadline,
      gradingMode: t.gradingMode,
      maxScore: t.rubric.maxScore,
      maxAttempts: t.maxAttempts,
      publishedAt: iso(t.publishedAt),
      ...st,
    };
  });
  const counts = Object.fromEntries(Object.entries(STUDENT_GROUPS).map(([k, states]) => [k, rows.filter((r) => states.includes(r.state)).length]));
  const filtered = STUDENT_GROUPS[group] ? rows.filter((r) => STUDENT_GROUPS[group].includes(r.state)) : rows;
  // Upcoming deadlines first among open work; everything else by publication.
  filtered.sort((a, b) => {
    const ao = STUDENT_GROUPS.todo.includes(a.state) ? 0 : 1;
    const bo = STUDENT_GROUPS.todo.includes(b.state) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (ao === 0 && (a.dueAt || b.dueAt)) return time(a.dueAt || '9999-12-31') - time(b.dueAt || '9999-12-31');
    return time(b.publishedAt) - time(a.publishedAt);
  });
  return { ok: true, tasks: filtered, counts, summary: studentSummaryOf(rows, attempts, tasks) };
}

function studentSummaryOf(rows, attemptsMap, tasks) {
  const graded = rows.filter((r) => r.result);
  const avg = graded.length ? percentText(graded.reduce((s, r) => s + r.result.score, 0), graded.reduce((s, r) => s + r.result.maxScore, 0)) : null;
  const byComp = {};
  for (const t of tasks) {
    const row = rows.find((r) => r.id === String(t._id));
    if (!row || !row.result) continue;
    const c = byComp[t.competency] || (byComp[t.competency] = { score: 0, max: 0, tasks: 0 });
    c.score += row.result.score;
    c.max += row.result.maxScore;
    c.tasks += 1;
  }
  let riskMet = 0;
  let riskChecked = 0;
  const history = [];
  for (const t of tasks) {
    for (const a of attemptsMap.get(String(t._id)) || []) {
      if (a.status !== 'graded' || !a.grade) continue;
      history.push({ taskId: String(t._id), title: t.title, attempt: a.attempt, percent: a.grade.percent, at: iso(a.gradedAt) });
      for (const c of (a.autoResult && a.autoResult.criteria) || []) {
        if (c.id === 'risk_within_limit' || c.id === 'stop_loss_valid') {
          riskChecked += 1;
          if (c.status === 'met') riskMet += 1;
        }
      }
    }
  }
  history.sort((a, b) => time(a.at) - time(b.at));
  return {
    completed: graded.length,
    pending: rows.filter((r) => STUDENT_GROUPS.todo.includes(r.state)).length,
    waiting: rows.filter((r) => r.state === 'awaiting_grading').length,
    averagePercent: avg,
    competencies: Object.entries(byComp).map(([id, c]) => ({ id, percent: percentText(c.score, c.max), tasks: c.tasks })),
    riskDiscipline: riskChecked ? { met: riskMet, checked: riskChecked, percent: percentText(riskMet, riskChecked) } : null,
    history: history.slice(-20),
  };
}

async function names(db, ids) {
  const valid = [...new Set(ids.map(String).filter(isId))];
  if (!valid.length) return new Map();
  const rows = await db.collection(C.users).find({ _id: { $in: valid.map(oid) } }, { projection: { name: 1 } }).toArray();
  return new Map(rows.map((u) => [String(u._id), u.name || 'Member']));
}

/** Own positions opened since the attempt started: the trades a student may attach. */
async function eligibleTrades(db, userId, since, through) {
  const rows = await db.collection(C.positions).find({ userId: String(userId), openedAt: { $gte: new Date(since), $lte: new Date(through) } }).sort({ openedAt: -1 }).limit(ELIGIBLE_TRADES).toArray();
  const orders = await ordersFor(db, userId, rows);
  return rows.map((p) => presentTrade(p, orders.get(String(p.orderId))));
}

async function ordersFor(db, userId, positions) {
  const ids = positions.map((p) => p.orderId).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await db.collection(C.orders).find({ _id: { $in: ids }, userId: String(userId) }, { projection: { type: 1, stopLoss: 1, takeProfit: 1 } }).toArray();
  return new Map(rows.map((o) => [String(o._id), o]));
}

async function studentTaskDetail(db, member, { taskId, now = new Date() }) {
  const found = await taskForStudent(db, member, taskId);
  if (!found.ok) return found;
  const task = found.task;
  const list = (await attemptsOf(db, [String(task._id)], member.userId)).get(String(task._id)) || [];
  for (const a of list) await finishPending(db, a, task, now);
  const st = studentState(task, list, now);
  const current = list.find((a) => a.status === 'in_progress') || null;
  const trades = current && task.requirements.simulator ? await eligibleTrades(db, member.userId, current.startedAt, now) : [];
  const owner = (await names(db, [task.ownerId])).get(String(task.ownerId)) || 'Instructor';
  const course = isId(String(task.courseId || '')) ? await db.collection(C.courses).findOne({ _id: oid(task.courseId) }, { projection: { title: 1 } }) : null;
  // An attempt in progress shows the rules it was started under.
  const shown = current ? { ...task, rubric: current.rubric, requirements: { ...current.requirements }, gradingMode: current.gradingMode } : task;
  return {
    ok: true,
    task: { ...S.presentTaskForStudent(shown), resources: task.resources || [], instructor: owner, course: course ? course.title : null, blocks: S.formatBlocks(task.instructions) },
    state: st,
    attempts: list.map(presentAttemptForStudent).reverse(),
    eligibleTrades: trades,
  };
}

/** Starts an attempt (idempotent). */
async function startAttempt(db, member, { taskId, now = new Date() }) {
  const found = await taskForStudent(db, member, taskId);
  if (!found.ok) return found;
  const task = found.task;
  const userId = String(member.userId);
  const list = (await attemptsOf(db, [String(task._id)], userId)).get(String(task._id)) || [];
  const open = list.find((a) => a.status === 'in_progress');
  if (open) return { ok: true, attempt: presentAttemptForStudent(open), repeated: true };
  if (list.some((a) => WAITING.includes(a.status))) return refuse(409, 'Your last submission is waiting for a grade.');
  const st = studentState(task, list, now);
  if (!st.canStart) {
    if (task.status !== 'published') return refuse(409, 'This task is closed.');
    if (st.state === 'overdue' || st.state === 'closed') return refuse(409, 'The deadline for this task has passed.');
    return refuse(409, 'You have used every attempt for this task.');
  }
  const latest = list[list.length - 1];
  const n = list.length + 1;
  const doc = {
    _id: attemptId(String(task._id), userId, n),
    schema: SCHEMA,
    taskId: String(task._id),
    studentId: userId,
    instructorId: String(task.ownerId),
    courseId: task.courseId,
    attempt: n,
    status: 'in_progress',
    revision: 0,
    resubmission: Boolean(latest && latest.status === 'returned'),
    graceUntil: latest && latest.status === 'returned' ? new Date(Math.max(time(task.dueAt), time(latest.returnedAt) + RETURN_GRACE_MS)) : null,
    taskVersion: task.version,
    rubric: task.rubric,
    requirements: { ...task.requirements, dueAt: task.dueAt || null },
    gradingMode: task.gradingMode,
    maxAttempts: task.maxAttempts,
    draft: { positionIds: [], explanation: '', external: null },
    attachments: [],
    attachmentsVersion: 0,
    evidencePositionIds: [],
    gradeHistory: [],
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.collection(C.attempts).insertOne(doc);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await db.collection(C.attempts).findOne({ _id: doc._id });
    return { ok: true, attempt: presentAttemptForStudent(existing), repeated: true };
  }
  return { ok: true, status: 201, attempt: presentAttemptForStudent(doc) };
}

const PRICE_TEXT = /^\d{1,7}(\.\d{1,6})?$/;
/** External, student-reported trade details. Every field optional; all marked unverified. */
function readExternal(input) {
  if (input === undefined || input === null || input === '') return { ok: true, external: null };
  if (typeof input !== 'object' || Array.isArray(input)) return refuse(400, 'External trade details are not valid.', { field: 'external' });
  const out = {};
  const broker = S.cleanText(input.broker, 60);
  if (broker === null) return refuse(400, 'The platform name is too long.', { field: 'external.broker' });
  if (broker) out.broker = broker;
  if (input.instrument) {
    const pair = String(input.instrument).toUpperCase().replace('/', '_');
    if (!/^[A-Z]{3}_[A-Z]{3}$/.test(pair)) return refuse(400, 'Enter the instrument as a pair such as EUR/USD.', { field: 'external.instrument' });
    out.instrument = pair;
  }
  if (input.side) {
    if (input.side !== 'buy' && input.side !== 'sell') return refuse(400, 'Direction must be buy or sell.', { field: 'external.side' });
    out.side = input.side;
  }
  for (const key of ['entry', 'exit', 'stopLoss', 'takeProfit']) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    const value = String(input[key]).trim();
    if (!PRICE_TEXT.test(value)) return refuse(400, 'Prices must be positive numbers.', { field: `external.${key}` });
    out[key] = value;
  }
  for (const key of ['openedAt', 'closedAt']) {
    if (!input[key]) continue;
    const at = new Date(input[key]);
    if (Number.isNaN(at.getTime())) return refuse(400, 'Enter valid dates and times.', { field: `external.${key}` });
    out[key] = at.toISOString();
  }
  const notes = S.cleanText(input.notes, 1000, { multiline: true });
  if (notes === null) return refuse(400, 'External notes can be at most 1000 characters.', { field: 'external.notes' });
  if (notes) out.notes = notes;
  return { ok: true, external: Object.keys(out).length ? { ...out, verified: false } : null };
}

function readPositionIds(value, max) {
  if (value === undefined || value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value) || value.length > Math.min(Math.max(max, 0), 10)) return refuse(400, `Attach at most ${max} trade${max === 1 ? '' : 's'}.`, { field: 'positionIds' });
  const ids = [...new Set(value.map(String))];
  if (ids.some((id) => !isId(id))) return refuse(400, 'One of the trades is not valid.', { field: 'positionIds' });
  return { ok: true, ids };
}

async function currentAttempt(db, member, taskId) {
  const found = await taskForStudent(db, member, taskId);
  if (!found.ok) return found;
  const attempt = await db.collection(C.attempts).findOne({ schema: SCHEMA, taskId: String(found.task._id), studentId: String(member.userId), status: 'in_progress' });
  if (!attempt) return refuse(409, 'Start the task first.');
  return { ok: true, task: found.task, attempt };
}

/** Saves the work in progress (explanation, chosen trades, external details). */
async function saveDraft(db, member, { taskId, body = {}, now = new Date() }) {
  const cur = await currentAttempt(db, member, taskId);
  if (!cur.ok) return cur;
  const explanation = S.cleanText(body.explanation, 6000, { multiline: true });
  if (explanation === null) return refuse(400, 'The explanation can be at most 6000 characters.', { field: 'explanation' });
  const ids = readPositionIds(body.positionIds, cur.attempt.requirements.maxTrades);
  if (!ids.ok) return ids;
  const external = readExternal(body.external);
  if (!external.ok) return external;
  await db.collection(C.attempts).updateOne({ _id: cur.attempt._id, status: 'in_progress' }, { $set: { draft: { positionIds: ids.ids, explanation, external: external.external }, updatedAt: now } });
  return { ok: true, savedAt: iso(now) };
}

/** Whether the attempt in progress can take another file (checked before uploading). */
async function attachmentSlot(db, member, { taskId }) {
  const cur = await currentAttempt(db, member, taskId);
  if (!cur.ok) return cur;
  const max = cur.attempt.requirements.maxAttachments;
  if ((cur.attempt.attachments || []).length >= max) return refuse(400, max ? `Attach at most ${max} files.` : 'This task does not take attachments.');
  return { ok: true };
}

/** Records an uploaded evidence file on the attempt in progress (the route uploaded it). */
async function addAttachment(db, member, { taskId, file, now = new Date() }) {
  const cur = await currentAttempt(db, member, taskId);
  if (!cur.ok) return cur;
  const max = cur.attempt.requirements.maxAttachments;
  const list = cur.attempt.attachments || [];
  if (list.length >= max) return refuse(400, max ? `Attach at most ${max} files.` : 'This task does not take attachments.');
  const entry = { id: new ObjectId().toHexString(), publicId: file.publicId, format: file.format || null, bytes: file.bytes || null, width: file.width || null, height: file.height || null, name: S.cleanText(file.name, 120) || `Evidence ${list.length + 1}`, delivery: file.delivery || 'private', uploadedAt: now };
  const won = await db.collection(C.attempts).updateOne({ _id: cur.attempt._id, status: 'in_progress', attachmentsVersion: cur.attempt.attachmentsVersion || 0 }, { $set: { attachments: [...list, entry], updatedAt: now }, $inc: { attachmentsVersion: 1 } });
  if (!won.matchedCount) return refuse(409, 'Your attachments changed in another window. Reload and try again.');
  return { ok: true, attachment: { id: entry.id, name: entry.name, url: `/api/practical-tasks/evidence?attempt=${encodeURIComponent(cur.attempt._id)}&file=${entry.id}` } };
}

async function removeAttachment(db, member, { taskId, fileId, now = new Date() }) {
  const cur = await currentAttempt(db, member, taskId);
  if (!cur.ok) return cur;
  const list = cur.attempt.attachments || [];
  const target = list.find((f) => f.id === fileId);
  if (!target) return refuse(404, 'Attachment not found');
  const won = await db.collection(C.attempts).updateOne({ _id: cur.attempt._id, status: 'in_progress', attachmentsVersion: cur.attempt.attachmentsVersion || 0 }, { $set: { attachments: list.filter((f) => f.id !== fileId), updatedAt: now }, $inc: { attachmentsVersion: 1 } });
  if (!won.matchedCount) return refuse(409, 'Your attachments changed in another window. Reload and try again.');
  return { ok: true, removed: target.publicId };
}

/** An evidence file for an authorised reader: the attempt's student or staff over the task. */
async function evidenceFile(db, member, { attempt: id, file }) {
  if (typeof id !== 'string' || !/^pt:[a-f0-9]{24}:[a-f0-9]{24}:\d{1,2}$/.test(id) || typeof file !== 'string' || !isId(file)) return refuse(404, 'Not found');
  const a = await db.collection(C.attempts).findOne({ _id: id, schema: SCHEMA });
  if (!a) return refuse(404, 'Not found');
  if (member.role === 'student') {
    if (String(a.studentId) !== String(member.userId)) return refuse(404, 'Not found');
  } else {
    const found = await taskForStaff(db, member, a.taskId);
    if (!found.ok) return refuse(404, 'Not found');
  }
  const f = (a.attachments || []).find((x) => x.id === file);
  return f ? { ok: true, publicId: f.publicId, format: f.format, delivery: f.delivery || 'private' } : refuse(404, 'Not found');
}

/**
 * Submits the attempt in progress. Body: { positionIds, explanation, external, confirm: true }.
 * Freezes the evidence from the server's records, then grades or queues it.
 */
async function submitAttempt(db, member, { taskId, body = {}, now = new Date() }) {
  const cur = await currentAttempt(db, member, taskId);
  if (!cur.ok) return cur;
  const { task, attempt } = cur;
  if (body.confirm !== true) return refuse(400, 'Review your submission and confirm it.', { field: 'confirm' });
  if (task.status !== 'published') return refuse(409, 'This task is closed.');
  const deadline = attempt.graceUntil ? time(attempt.graceUntil) : task.dueAt ? time(task.dueAt) : null;
  if (deadline !== null && now.getTime() > deadline) return refuse(409, 'The deadline for this task has passed.');
  const req = attempt.requirements;
  const explanation = S.cleanText(body.explanation, 6000, { multiline: true });
  if (explanation === null) return refuse(400, 'The explanation can be at most 6000 characters.', { field: 'explanation' });
  const ids = readPositionIds(body.positionIds, req.maxTrades);
  if (!ids.ok) return ids;
  const external = readExternal(body.external);
  if (!external.ok) return external;
  if (req.simulator && ids.ids.length < req.minTrades) return refuse(400, `Attach at least ${req.minTrades} simulator trade${req.minTrades === 1 ? '' : 's'} placed during this task.`, { field: 'positionIds' });
  if (ids.ids.length > req.maxTrades) return refuse(400, `Attach at most ${req.maxTrades} trades.`, { field: 'positionIds' });
  if (req.external === 'required' && !(attempt.attachments || []).length) return refuse(400, 'This task requires screenshots from the external platform.', { field: 'attachments' });

  // Evidence from the server's records only: the student's own positions, inside the window.
  const positions = ids.ids.length ? await db.collection(C.positions).find({ _id: { $in: ids.ids.map(oid) }, userId: String(member.userId) }).toArray() : [];
  if (positions.length !== ids.ids.length) return refuse(400, 'One of the trades is not one of your simulator trades.', { field: 'positionIds' });
  const outside = positions.filter((p) => time(p.openedAt) < time(attempt.startedAt) || time(p.openedAt) > now.getTime());
  if (outside.length) return refuse(400, 'Only trades opened after you started this attempt can be attached.', { field: 'positionIds' });
  if (positions.length) {
    const used = await db.collection(C.attempts).find({ schema: SCHEMA, studentId: String(member.userId), status: { $ne: 'in_progress' }, evidencePositionIds: { $in: ids.ids } }, { projection: { _id: 1 } }).limit(1).toArray();
    if (used.length) return refuse(400, 'One of these trades was already submitted for another task attempt.', { field: 'positionIds' });
  }
  const orders = await ordersFor(db, member.userId, positions);
  const accountIds = [...new Set(positions.map((p) => p.accountId).filter(Boolean).map(String))];
  const accounts = accountIds.length ? await db.collection(C.accounts).find({ _id: { $in: positions.map((p) => p.accountId).filter(Boolean) } }, { projection: { startingBalance: 1, userId: 1 } }).toArray() : [];
  const balance = new Map(accounts.filter((a) => String(a.userId) === String(member.userId)).map((a) => [String(a._id), d(a.startingBalance)]));
  const order = new Map(ids.ids.map((id, i) => [id, i]));
  const trades = positions
    .sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)))
    .map((p) => ({ ...presentTrade(p, orders.get(String(p.orderId))), startingBalance: balance.get(String(p.accountId)) || null }));
  const evidence = {
    trades,
    startingBalance: trades.length ? trades[0].startingBalance : null,
    windowStart: iso(attempt.startedAt),
    windowEnd: iso(now),
    explanationLength: (explanation || '').length,
    attachments: (attempt.attachments || []).length,
    frozenAt: iso(now),
  };
  const won = await db.collection(C.attempts).updateOne(
    { _id: attempt._id, status: 'in_progress' },
    { $set: { status: 'submitted', submittedAt: now, explanation: explanation || '', external: external.external, evidence, evidencePositionIds: trades.map((x) => x.positionId), draft: null, updatedAt: now }, $inc: { revision: 1 } }
  );
  if (!won.matchedCount) return refuse(409, 'This attempt was already submitted.');
  const submitted = await db.collection(C.attempts).findOne({ _id: attempt._id });
  const finished = await finishPending(db, submitted, task, now);
  const notify = [];
  if (finished.status === 'graded') {
    notify.push(resultNotice(task, finished));
  } else {
    notify.push({
      userIds: [String(task.ownerId)],
      type: 'task_submission',
      title: finished.status === 'awaiting_review' ? 'Practical task ready for review' : 'Practical task to grade',
      message: `A student submitted ${task.title} (attempt ${attempt.attempt}).`,
      roleTarget: 'instructor',
      taskId: String(task._id),
      relatedId: attempt._id,
      dedupeKey: `practical-submission:${attempt._id}`,
      metadata: { href: href.review(attempt._id), taskTitle: task.title },
    });
  }
  return { ok: true, attempt: presentAttemptForStudent(finished), notify };
}

function resultNotice(task, a) {
  return {
    userIds: [String(a.studentId)],
    type: 'task_feedback',
    title: a.status === 'returned' ? 'Practical task returned for revision' : 'Practical task graded',
    message: a.status === 'returned' ? `${task.title}: your instructor returned attempt ${a.attempt} with feedback.` : `${task.title}: ${a.grade.score} / ${a.grade.maxScore} (${a.grade.percent}%).`,
    roleTarget: 'student',
    taskId: String(task._id),
    relatedId: a._id,
    dedupeKey: `practical-result:${a._id}:${a.revision}`,
    metadata: { href: href.student(String(task._id)), taskTitle: task.title },
  };
}

/**
 * Finishes a 'submitted' attempt: runs the engine (automatic and assisted) and moves it on.
 * Idempotent: only a 'submitted' attempt changes, by a conditional update.
 */
async function finishPending(db, a, task, now = new Date()) {
  if (!a || a.status !== 'submitted') return a;
  const result = a.gradingMode === 'manual' ? null : gradePractical({ rubric: a.rubric, requirements: a.requirements, evidence: a.evidence });
  let set;
  if (a.gradingMode === 'automatic' && result.complete) {
    const grade = { score: result.score, maxScore: result.maxScore, percent: result.percent, criteria: result.criteria.map((c) => ({ id: c.id, score: c.score, feedback: null })), feedback: null, source: 'system', gradedBy: null, publishedAt: now };
    set = { status: 'graded', autoResult: result, grade, gradedAt: now, gradeHistory: [...(a.gradeHistory || []), { at: now, by: null, role: 'system', action: 'auto_graded', score: grade.score, maxScore: grade.maxScore, engine: `${result.engine} ${result.version}`, fingerprint: result.fingerprint, revision: a.revision + 1 }] };
  } else if (a.gradingMode === 'assisted' || a.gradingMode === 'automatic') {
    // An automatic rubric that cannot be fully checked (never created by the editor) waits for review.
    set = { status: 'awaiting_review', autoResult: result, gradeHistory: [...(a.gradeHistory || []), { at: now, by: null, role: 'system', action: 'auto_assessed', score: result.autoScore, maxScore: result.autoMax, engine: `${result.engine} ${result.version}`, fingerprint: result.fingerprint, revision: a.revision + 1 }] };
  } else {
    set = { status: 'awaiting_grading' };
  }
  const won = await db.collection(C.attempts).updateOne({ _id: a._id, status: 'submitted', revision: a.revision }, { $set: { ...set, updatedAt: now }, $inc: { revision: 1 } });
  const fresh = await db.collection(C.attempts).findOne({ _id: a._id });
  if (won.matchedCount && fresh.status === 'graded') {
    await audit(db, auditEntry({ entityType: 'practical_submission', entityId: a._id, action: 'practical_auto_graded', actor: { userId: 'system', role: 'system' }, after: { score: fresh.grade.score, maxScore: fresh.grade.maxScore, engine: `${result.engine} ${result.version}`, fingerprint: result.fingerprint }, context: { taskId: String(task._id), studentId: a.studentId, courseId: task.courseId }, now }));
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Instructor: lists, detail, analytics
// ---------------------------------------------------------------------------

async function staffTasks(db, member, { status = '', courseId = '', q = '', page, limit } = {}) {
  if (!isStaff(member)) return refuse(403, 'Not authorized');
  const scope = await teachingScope(db, member, courseId ? { courseId } : {});
  if (!scope.ok) return scope.status === 404 ? { ok: true, tasks: [], counts: {}, pagination: { page: 1, pages: 1, total: 0 }, courses: [] } : scope;
  const filter = { schema: SCHEMA, courseId: { $in: scope.ids } };
  if (member.role === 'instructor') filter.courseId = { $in: scope.ids };
  if (S.TASK_STATUSES.includes(status)) filter.status = status;
  const search = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  if (search) filter.title = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const p = pageOf(page, limit);
  const total = await db.collection(C.tasks).countDocuments(filter);
  const tasks = await db.collection(C.tasks).find(filter).sort({ updatedAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).toArray();
  const ids = tasks.map((t) => String(t._id));
  const attempts = ids.length ? await db.collection(C.attempts).find({ schema: SCHEMA, taskId: { $in: ids } }, { projection: { taskId: 1, studentId: 1, status: 1, attempt: 1, grade: 1 } }).limit(20000).toArray() : [];
  const allCounts = {};
  for (const s of S.TASK_STATUSES) allCounts[s] = await db.collection(C.tasks).countDocuments({ schema: SCHEMA, courseId: { $in: scope.ids }, status: s });
  const rows = tasks.map((t) => {
    const mine = attempts.filter((a) => a.taskId === String(t._id));
    const stats = taskStats(t, mine);
    return { id: String(t._id), title: t.title, status: t.status, course: (scope.byId.get(String(t.courseId)) || {}).title || null, courseId: t.courseId, category: (S.CATEGORIES[t.category] || {}).label || t.category, difficulty: t.difficulty, instruments: t.instruments, gradingMode: t.gradingMode, maxScore: t.rubric.maxScore, dueAt: iso(t.dueAt), publishedAt: iso(t.publishedAt), updatedAt: iso(t.updatedAt), source: t.source || 'manual', ...stats };
  });
  const toGrade = await db.collection(C.attempts).countDocuments({ schema: SCHEMA, courseId: { $in: scope.ids }, status: { $in: ['awaiting_grading', 'awaiting_review'] } });
  return { ok: true, tasks: rows, counts: allCounts, toGrade, pagination: { page: p.page, pages: Math.max(1, Math.ceil(total / p.limit)), total }, courses: scope.courses.map((c) => ({ id: String(c._id), title: c.title })), readOnly: member.role !== 'instructor' };
}

/** Per-task figures from actual attempts. The latest attempt per student is their state. */
function taskStats(task, attempts) {
  const recipients = (task.recipients || []).length;
  const latest = new Map();
  for (const a of attempts) if (!latest.has(a.studentId) || latest.get(a.studentId).attempt < a.attempt) latest.set(a.studentId, a);
  const gradedBest = new Map();
  for (const a of attempts) if (a.status === 'graded' && a.grade && (!gradedBest.has(a.studentId) || gradedBest.get(a.studentId).attempt < a.attempt)) gradedBest.set(a.studentId, a);
  const started = latest.size;
  const submittedStudents = new Set(attempts.filter((a) => a.status !== 'in_progress').map((a) => a.studentId)).size;
  const waiting = [...latest.values()].filter((a) => ['awaiting_grading', 'awaiting_review', 'submitted'].includes(a.status)).length;
  const graded = gradedBest.size;
  const scoreSum = [...gradedBest.values()].reduce((s, a) => s + a.grade.score, 0);
  const maxSum = [...gradedBest.values()].reduce((s, a) => s + a.grade.maxScore, 0);
  return {
    recipients,
    started,
    submitted: submittedStudents,
    waiting,
    graded,
    submissionRate: recipients ? percentText(submittedStudents, recipients) : null,
    completionRate: recipients ? percentText(graded, recipients) : null,
    averagePercent: maxSum ? percentText(scoreSum, maxSum) : null,
  };
}

async function staffTaskDetail(db, member, { taskId, now = new Date() }) {
  const found = await taskForStaff(db, member, taskId);
  if (!found.ok) return found;
  const task = found.task;
  const attempts = await db.collection(C.attempts).find({ schema: SCHEMA, taskId: String(task._id) }).sort({ attempt: 1 }).limit(20000).toArray();
  for (const a of attempts) if (a.status === 'submitted') Object.assign(a, await finishPending(db, a, task, now));
  const recipientIds = (task.recipients || []).map(String);
  const nameOf = await names(db, recipientIds);
  const byStudent = new Map();
  for (const a of attempts) {
    if (!byStudent.has(a.studentId)) byStudent.set(a.studentId, []);
    byStudent.get(a.studentId).push(a);
  }
  const students = recipientIds.map((id) => {
    const list = byStudent.get(id) || [];
    const st = studentState(task, list, now);
    const latest = list[list.length - 1];
    return { id, name: nameOf.get(id) || 'Student', state: st.state, attemptsUsed: st.attemptsUsed, result: st.result, latestAttemptId: latest ? latest._id : null, submittedAt: latest ? iso(latest.submittedAt) : null };
  });
  // Frequently missed criteria over the latest graded or assessed attempt of each student.
  const missed = {};
  for (const list of byStudent.values()) {
    const a = [...list].reverse().find((x) => x.autoResult || x.grade);
    if (!a) continue;
    for (const c of a.rubric.criteria) {
      const g = a.grade && (a.grade.criteria || []).find((x) => x.id === c.id);
      const auto = a.autoResult && a.autoResult.criteria.find((x) => x.id === c.id);
      const score = g && typeof g.score === 'number' ? g.score : auto && typeof auto.score === 'number' ? auto.score : null;
      if (score === null) continue;
      const m = missed[c.id] || (missed[c.id] = { id: c.id, label: c.label, assessed: 0, missed: 0 });
      m.assessed += 1;
      if (score < c.points) m.missed += 1;
    }
  }
  const eligible = task.status === 'draft' || task.status === 'published' ? await enrolledStudents(db, task.courseId) : [];
  return {
    ok: true,
    task: presentStaffTask(task),
    course: found.course ? { id: String(found.course._id), title: found.course.title } : null,
    stats: taskStats(task, attempts),
    students,
    missedCriteria: Object.values(missed).filter((m) => m.missed).sort((a, b) => b.missed - a.missed),
    eligibleStudents: eligible.map((s) => ({ ...s, assigned: recipientIds.includes(s.id) })),
    attemptsExist: attempts.length > 0,
    readOnly: Boolean(found.readOnly),
  };
}

const QUEUE = Object.freeze({ pending: ['awaiting_grading', 'awaiting_review', 'submitted'], graded: ['graded'], returned: ['returned'], all: ['submitted', 'awaiting_grading', 'awaiting_review', 'graded', 'returned'] });

async function staffQueue(db, member, { filter = 'pending', taskId = '', courseId = '', studentId = '', mode = '', from = '', to = '', page, limit } = {}) {
  if (!isStaff(member)) return refuse(403, 'Not authorized');
  const scope = await teachingScope(db, member, courseId ? { courseId } : {});
  if (!scope.ok) return scope.status === 404 ? { ok: true, rows: [], counts: {}, pagination: { page: 1, pages: 1, total: 0 } } : scope;
  const q = { schema: SCHEMA, courseId: { $in: scope.ids }, status: { $in: QUEUE[filter] || QUEUE.pending } };
  if (taskId) {
    if (!isId(taskId)) return refuse(404, 'Task not found');
    q.taskId = taskId;
  }
  if (studentId) {
    if (!isId(studentId)) return refuse(404, 'Student not found');
    q.studentId = studentId;
  }
  if (S.GRADING_MODES.includes(mode)) q.gradingMode = mode;
  const range = {};
  if (from && !Number.isNaN(new Date(from).getTime())) range.$gte = new Date(from);
  if (to && !Number.isNaN(new Date(to).getTime())) range.$lte = new Date(new Date(to).getTime() + 86399999);
  if (Object.keys(range).length) q.submittedAt = range;
  const p = pageOf(page, limit);
  const total = await db.collection(C.attempts).countDocuments(q);
  const rows = await db.collection(C.attempts).find(q, { projection: { evidence: 0, draft: 0 } }).sort({ submittedAt: filter === 'pending' ? 1 : -1 }).skip(p.skip).limit(p.limit).toArray();
  const counts = {};
  for (const [k, statuses] of Object.entries(QUEUE)) if (k !== 'all') counts[k] = await db.collection(C.attempts).countDocuments({ ...q, status: { $in: statuses } });
  const taskIds = [...new Set(rows.map((r) => r.taskId))];
  const tasks = taskIds.length ? await db.collection(C.tasks).find({ _id: { $in: taskIds.map(oid) } }, { projection: { title: 1, dueAt: 1 } }).toArray() : [];
  const title = new Map(tasks.map((t) => [String(t._id), t]));
  const who = await names(db, rows.map((r) => r.studentId));
  return {
    ok: true,
    rows: rows.map((r) => ({ id: r._id, taskId: r.taskId, task: (title.get(r.taskId) || {}).title || 'Task', student: who.get(r.studentId) || 'Student', studentId: r.studentId, attempt: r.attempt, status: r.status, gradingMode: r.gradingMode, submittedAt: iso(r.submittedAt), late: Boolean(title.get(r.taskId) && title.get(r.taskId).dueAt && time(r.submittedAt) > time(title.get(r.taskId).dueAt)), score: r.grade ? r.grade.score : r.autoResult ? r.autoResult.autoScore : null, maxScore: r.rubric.maxScore, suggested: !r.grade && r.autoResult ? true : false })),
    counts,
    pagination: { page: p.page, pages: Math.max(1, Math.ceil(total / p.limit)), total },
    tasks: tasks.map((t) => ({ id: String(t._id), title: t.title })),
  };
}

/** Everything the grading workspace needs, for staff over the task. */
async function staffAttempt(db, member, { attemptId: id, now = new Date() }) {
  if (!isStaff(member)) return refuse(403, 'Not authorized');
  if (typeof id !== 'string' || !/^pt:[a-f0-9]{24}:[a-f0-9]{24}:\d{1,2}$/.test(id)) return refuse(404, 'Submission not found');
  let a = await db.collection(C.attempts).findOne({ _id: id, schema: SCHEMA });
  if (!a) return refuse(404, 'Submission not found');
  const found = await taskForStaff(db, member, a.taskId);
  if (!found.ok) return refuse(404, 'Submission not found');
  a = await finishPending(db, a, found.task, now);
  const others = await db.collection(C.attempts).find({ schema: SCHEMA, taskId: a.taskId, studentId: a.studentId }, { projection: { attempt: 1, status: 1, grade: 1, submittedAt: 1 } }).sort({ attempt: 1 }).toArray();
  const student = await db.collection(C.users).findOne({ _id: oid(a.studentId) }, { projection: { name: 1, learningLevel: 1 } });
  const graders = await names(db, (a.gradeHistory || []).map((h) => h.by).filter(Boolean));
  const view = presentAttemptForStudent(a);
  return {
    ok: true,
    readOnly: Boolean(found.readOnly),
    task: presentStaffTask(found.task),
    student: { id: a.studentId, name: (student && student.name) || 'Student', level: (student && student.learningLevel) || null },
    attempt: {
      ...view,
      revision: a.revision,
      rubric: a.rubric,
      requirements: a.requirements,
      autoResult: a.autoResult || null,
      grade: a.grade || null,
      result: a.grade ? presentGrade(a) : null,
      history: (a.gradeHistory || []).map((h) => ({ at: iso(h.at), by: h.by ? graders.get(String(h.by)) || 'Instructor' : 'System', role: h.role, action: h.action, score: h.score ?? null, maxScore: h.maxScore ?? null, reason: h.reason || null, engine: h.engine || null })),
    },
    previous: others.filter((o) => o._id !== a._id).map((o) => ({ id: o._id, attempt: o.attempt, status: o.status, score: o.grade ? o.grade.score : null, maxScore: o.grade ? o.grade.maxScore : null, submittedAt: iso(o.submittedAt) })),
  };
}

function readFeedback(input) {
  const f = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of ['summary', 'strengths', 'mistakes', 'recommendations']) {
    const value = S.cleanText(f[key], FEEDBACK_MAX, { multiline: true });
    if (value === null) return refuse(400, `Feedback fields can be at most ${FEEDBACK_MAX} characters.`, { field: `feedback.${key}` });
    out[key] = value;
  }
  return { ok: true, feedback: out };
}

/**
 * Grades, returns or changes a grade. Body: { decision: 'publish' | 'return', scores: {id: n},
 * criterionFeedback: {id: text}, feedback: {...}, expectedRevision, reason? }.
 *   manual    every criterion needs a score.
 *   assisted  automatic criteria default to the engine's score; changing one needs a reason.
 *   automatic already graded by the system; a change is a reviewed override and needs a reason.
 * A changed published grade always needs a reason. Concurrent graders: the revision must match.
 */
async function gradeAttempt(db, member, { attemptId: id, body = {}, now = new Date() }) {
  if (!member || member.role !== 'instructor') return refuse(403, 'Only the course instructor can grade practical tasks.');
  if (typeof id !== 'string' || !/^pt:[a-f0-9]{24}:[a-f0-9]{24}:\d{1,2}$/.test(id)) return refuse(404, 'Submission not found');
  let a = await db.collection(C.attempts).findOne({ _id: id, schema: SCHEMA });
  if (!a) return refuse(404, 'Submission not found');
  const found = await taskForStaff(db, member, a.taskId, { write: true });
  if (!found.ok) return refuse(404, 'Submission not found');
  const task = found.task;
  a = await finishPending(db, a, task, now);
  if (!['awaiting_grading', 'awaiting_review', 'graded'].includes(a.status)) return refuse(409, a.status === 'returned' ? 'This attempt was returned to the student.' : 'This attempt is not ready for grading.');
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== a.revision) return refuse(409, 'Someone else changed this submission. Reload it to see their grade before changing it.', { code: 'stale_revision' });
  const decision = body.decision === 'return' ? 'return' : body.decision === 'publish' ? 'publish' : null;
  if (!decision) return refuse(400, 'Choose to publish the grade or return the work.', { field: 'decision' });
  const fb = readFeedback(body.feedback);
  if (!fb.ok) return fb;
  const reason = S.cleanText(body.reason, 500) || '';
  const scoresIn = body.scores && typeof body.scores === 'object' ? body.scores : {};
  const notesIn = body.criterionFeedback && typeof body.criterionFeedback === 'object' ? body.criterionFeedback : {};
  const autoById = new Map(((a.autoResult && a.autoResult.criteria) || []).map((c) => [c.id, c]));
  const previous = a.grade ? new Map((a.grade.criteria || []).map((c) => [c.id, c.score])) : null;

  if (decision === 'return') {
    if (a.status === 'graded') return refuse(409, 'A graded attempt cannot be returned. Change the grade instead, or the student can make another attempt.');
    if (!fb.feedback.summary && !fb.feedback.mistakes && !fb.feedback.recommendations) return refuse(400, 'Tell the student what to revise.', { field: 'feedback.summary' });
    const won = await db.collection(C.attempts).updateOne(
      { _id: a._id, revision: a.revision, status: a.status },
      { $set: { status: 'returned', returnedAt: now, returnFeedback: fb.feedback, grade: { score: null, maxScore: a.rubric.maxScore, percent: null, criteria: [], feedback: fb.feedback, source: 'instructor', gradedBy: String(member.userId), publishedAt: now }, gradeHistory: [...(a.gradeHistory || []), { at: now, by: String(member.userId), role: 'instructor', action: 'returned', revision: a.revision + 1 }], updatedAt: now }, $inc: { revision: 1 } }
    );
    if (!won.matchedCount) return refuse(409, 'Someone else changed this submission. Reload it.', { code: 'stale_revision' });
    await audit(db, auditEntry({ entityType: 'practical_submission', entityId: a._id, action: 'practical_returned', actor: member, context: { taskId: a.taskId, studentId: a.studentId, courseId: task.courseId }, now }));
    const fresh = await db.collection(C.attempts).findOne({ _id: a._id });
    return { ok: true, attempt: fresh.status, revision: fresh.revision, notify: [resultNotice(task, fresh)] };
  }

  const criteria = [];
  let adjustedAuto = false;
  for (const c of a.rubric.criteria) {
    const raw = scoresIn[c.id];
    const auto = autoById.get(c.id);
    let score;
    if (raw === undefined || raw === null || raw === '') {
      if (previous && typeof previous.get(c.id) === 'number') score = previous.get(c.id);
      else if (auto && typeof auto.score === 'number') score = auto.score;
      else return refuse(400, `Score "${c.label}".`, { field: `scores.${c.id}` });
    } else {
      score = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
      if (!Number.isInteger(score) || score < 0 || score > c.points) return refuse(400, `"${c.label}" is scored 0-${c.points}.`, { field: `scores.${c.id}` });
    }
    if (auto && typeof auto.score === 'number' && score !== auto.score) adjustedAuto = true;
    // Criterion feedback not sent again keeps what was written before.
    const sent = Object.prototype.hasOwnProperty.call(notesIn, c.id);
    const note = sent ? S.cleanText(notesIn[c.id], 600, { multiline: true }) : (((a.grade && a.grade.criteria) || []).find((x) => x.id === c.id) || {}).feedback || '';
    if (note === null) return refuse(400, 'Criterion feedback can be at most 600 characters.', { field: `criterionFeedback.${c.id}` });
    criteria.push({ id: c.id, score, feedback: note || null });
  }
  const score = criteria.reduce((s, c) => s + c.score, 0);
  const maxScore = a.rubric.maxScore;
  const changingPublished = a.status === 'graded';
  const changedScore = changingPublished && criteria.some((c) => previous && previous.get(c.id) !== c.score);
  if ((changingPublished || adjustedAuto) && reason.length < REASON_MIN) {
    return refuse(400, changingPublished ? `Changing a published grade needs a reason of at least ${REASON_MIN} characters; it is recorded and shown in the grade history.` : `You changed an automatically assessed criterion. Give a reason of at least ${REASON_MIN} characters; it is recorded.`, { field: 'reason' });
  }
  if (changingPublished && !changedScore && JSON.stringify(a.grade.feedback || {}) === JSON.stringify(fb.feedback) && criteria.every((c) => ((a.grade.criteria || []).find((x) => x.id === c.id) || {}).feedback === c.feedback)) {
    return refuse(400, 'Nothing changed.');
  }
  const grade = { score, maxScore, percent: percentText(score, maxScore), criteria, feedback: fb.feedback, source: a.gradingMode === 'automatic' && !changingPublished ? 'system' : 'instructor', gradedBy: String(member.userId), publishedAt: now };
  const action = changingPublished ? (a.gradingMode === 'automatic' && a.grade.source === 'system' ? 'override' : 'regraded') : a.gradingMode === 'assisted' ? 'reviewed' : 'graded';
  const history = [...(a.gradeHistory || []), { at: now, by: String(member.userId), role: 'instructor', action, score, maxScore, previousScore: a.grade ? a.grade.score : null, reason: reason || undefined, revision: a.revision + 1 }];
  const won = await db.collection(C.attempts).updateOne(
    { _id: a._id, revision: a.revision, status: a.status },
    { $set: { status: 'graded', grade, gradedAt: now, gradeHistory: history, updatedAt: now }, $inc: { revision: 1 } }
  );
  if (!won.matchedCount) return refuse(409, 'Someone else changed this submission. Reload it to see their grade before changing it.', { code: 'stale_revision' });
  await audit(db, auditEntry({ entityType: 'practical_submission', entityId: a._id, action: `practical_${action === 'graded' || action === 'reviewed' ? 'grade_published' : 'grade_changed'}`, actor: member, reason, before: a.grade ? { score: a.grade.score, maxScore: a.grade.maxScore, source: a.grade.source } : a.autoResult ? { suggested: a.autoResult.autoScore, of: a.autoResult.autoMax } : null, after: { score, maxScore, mode: a.gradingMode }, context: { taskId: a.taskId, studentId: a.studentId, courseId: task.courseId }, now }));
  const fresh = await db.collection(C.attempts).findOne({ _id: a._id });
  return { ok: true, attempt: fresh.status, revision: fresh.revision, grade: { score, maxScore, percent: grade.percent }, notify: [resultNotice(task, fresh)] };
}

/** Instructor overview figures for the practical tasks home. */
async function staffSummary(db, member) {
  if (!isStaff(member)) return refuse(403, 'Not authorized');
  const scope = await teachingScope(db, member, {});
  if (!scope.ok) return scope;
  const tasks = await db.collection(C.tasks).find({ schema: SCHEMA, courseId: { $in: scope.ids } }, { projection: { gradingMode: 1, status: 1, recipients: 1 } }).limit(2000).toArray();
  const modes = { automatic: 0, manual: 0, assisted: 0 };
  for (const t of tasks) modes[t.gradingMode] = (modes[t.gradingMode] || 0) + 1;
  const graded = await db.collection(C.attempts).find({ schema: SCHEMA, courseId: { $in: scope.ids }, status: 'graded' }, { projection: { grade: 1 } }).limit(20000).toArray();
  const sum = graded.reduce((s, a) => s + (a.grade.score || 0), 0);
  const max = graded.reduce((s, a) => s + (a.grade.maxScore || 0), 0);
  return {
    ok: true,
    tasks: tasks.length,
    published: tasks.filter((t) => t.status === 'published').length,
    assignedStudents: new Set(tasks.flatMap((t) => t.recipients || [])).size,
    modes,
    toGrade: await db.collection(C.attempts).countDocuments({ schema: SCHEMA, courseId: { $in: scope.ids }, status: { $in: ['awaiting_grading', 'awaiting_review'] } }),
    gradedAttempts: graded.length,
    averagePercent: max ? percentText(sum, max) : null,
  };
}

module.exports = {
  ATTEMPT_STATUSES,
  COLLECTIONS: C,
  MAX_RECIPIENTS,
  RETURN_GRACE_MS,
  SCHEMA,
  addAttachment,
  attachmentSlot,
  attemptId,
  changeTaskStatus,
  discardDraft,
  enrolledStudents,
  evidenceFile,
  finishPending,
  gradeAttempt,
  previewDefinition,
  previewGenerated,
  publishTask,
  readExternal,
  removeAttachment,
  saveDraft,
  saveTask,
  staffAttempt,
  staffQueue,
  staffSummary,
  staffTaskDetail,
  staffTasks,
  startAttempt,
  studentState,
  studentTaskDetail,
  studentTasks,
  submitAttempt,
  taskForStaff,
  taskForStudent,
};

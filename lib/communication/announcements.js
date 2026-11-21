'use strict';

/**
 * Announcements (Phase 14). Stored in the existing `communityNews` collection with
 * kind: 'announcement' (no new collection; every community-news route ignores this kind).
 *
 * Audiences:  all (every active member), students, instructors, course (active enrollees of one
 *             course, plus its instructor).
 * Who:        Admin and Super Admin: any audience. Instructors: course audiences for courses they
 *             teach only. Students: none.
 * Lifecycle:  draft -> scheduled (publishAt in the future) -> published -> archived; a published
 *             announcement stops showing after expiresAt. Publishing notifies each recipient once
 *             (dedupe key announcement:<id>); the worker publishes due scheduled ones.
 * Read state: the recipient's own notification copy (no ever-growing reader list).
 * Every create, publish, edit and archive is written to the audit log.
 */

const { ObjectId } = require('mongodb');
const { AUDIT_COLLECTION } = require('../course-payment');
const { isActiveEnrollment } = require('../enrollment-state');

const KIND = 'announcement';
const AUDIENCES = Object.freeze(['all', 'students', 'instructors', 'course']);
const STATUSES = Object.freeze(['draft', 'scheduled', 'published', 'archived']);
const MAX_RECIPIENTS = 20000;
const PAGE = 20;

const isId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const refuse = (status, error, field) => ({ ok: false, status, error, ...(field ? { field } : {}) });
const clean = (v, max, multiline = false) => {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '').replace(/<[^>]*>/g, '').trim();
  return s.slice(0, max);
};
const isStaffAdmin = (m) => m && (m.role === 'admin' || m.role === 'superadmin');

async function audit(db, member, action, id, detail, now) {
  try {
    await db.collection(AUDIT_COLLECTION).insertOne({ entityType: 'announcement', entityId: String(id), reference: null, action, reason: '', before: null, after: detail, outcome: 'saved', actor: { userId: String(member.userId), email: member.email || null, role: member.role }, createdAt: now });
  } catch {
    console.error(JSON.stringify({ event: 'announcementAudit', action, result: 'write_failed' }));
  }
}

async function teaches(db, member, courseId) {
  if (!isId(courseId)) return false;
  const course = await db.collection('courses').findOne({ _id: new ObjectId(courseId) }, { projection: { instructorId: 1 } });
  return Boolean(course) && (isStaffAdmin(member) || String(course.instructorId) === String(member.userId));
}

/** Validates the editor's input. */
async function readAnnouncement(db, member, body, { now = new Date() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const title = clean(b.title, 140);
  if (!title) return refuse(400, 'A title is required.', 'title');
  const message = clean(b.body, 4000, true);
  if (!message) return refuse(400, 'The announcement needs a message.', 'body');
  if (!AUDIENCES.includes(b.audience)) return refuse(400, 'Choose who receives it.', 'audience');
  let courseId = null;
  if (b.audience === 'course') {
    if (!(await teaches(db, member, b.courseId))) return refuse(403, 'You can only announce to courses you teach.', 'courseId');
    courseId = String(b.courseId);
  } else if (!isStaffAdmin(member)) {
    return refuse(403, 'Only administrators can announce to the whole academy.', 'audience');
  }
  const date = (v) => (v ? new Date(v) : null);
  const publishAt = date(b.publishAt);
  const expiresAt = date(b.expiresAt);
  if (publishAt && Number.isNaN(publishAt.getTime())) return refuse(400, 'The publish time is not valid.', 'publishAt');
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= (publishAt || now))) return refuse(400, 'The expiry must be after publication.', 'expiresAt');
  const link = typeof b.link === 'string' && b.link.startsWith('/') && !b.link.startsWith('//') ? b.link.slice(0, 300) : null;
  return { ok: true, fields: { title, body: message, audience: b.audience, courseId, publishAt, expiresAt, link } };
}

function present(a) {
  return { id: String(a._id), title: a.title, body: a.body, audience: a.audience, courseId: a.courseId || null, status: a.status, publishAt: a.publishAt ? new Date(a.publishAt).toISOString() : null, publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : null, expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null, link: a.link || null, createdBy: a.createdBy, recipients: a.recipientCount || 0, createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : null };
}

/** Recipient ids for an audience (active accounts only). */
async function recipientsFor(db, a) {
  const users = db.collection('users');
  const active = { $or: [{ status: 'approved' }, { status: { $exists: false } }] };
  if (a.audience === 'course') {
    const rows = await db.collection('progress').find({ courseId: { $in: [a.courseId, new ObjectId(a.courseId)] } }, { projection: { userId: 1, active: 1, withdrawnAt: 1, progress: 1, completedAt: 1, courseId: 1 } }).toArray();
    const ids = [...new Set(rows.filter(isActiveEnrollment).map((r) => String(r.userId)).filter(isId))];
    const course = await db.collection('courses').findOne({ _id: new ObjectId(a.courseId) }, { projection: { instructorId: 1 } });
    const found = ids.length ? await users.find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, ...active }, { projection: { _id: 1 } }).toArray() : [];
    const out = found.map((u) => String(u._id));
    if (course && isId(String(course.instructorId || '')) && !out.includes(String(course.instructorId))) out.push(String(course.instructorId));
    return out;
  }
  const role = a.audience === 'students' ? { role: 'student' } : a.audience === 'instructors' ? { role: 'instructor' } : { role: { $in: ['student', 'instructor', 'admin', 'superadmin'] } };
  return (await users.find({ ...role, ...active }, { projection: { _id: 1 } }).limit(MAX_RECIPIENTS).toArray()).map((u) => String(u._id));
}

async function create(db, member, body, { now = new Date() } = {}) {
  if (!member || !['instructor', 'admin', 'superadmin'].includes(member.role)) return refuse(403, 'Not authorized');
  const checked = await readAnnouncement(db, member, body, { now });
  if (!checked.ok) return checked;
  const doc = { _id: new ObjectId(), kind: KIND, ...checked.fields, status: 'draft', createdBy: String(member.userId), createdAt: now, updatedAt: now, version: 1 };
  await db.collection('communityNews').insertOne(doc);
  await audit(db, member, 'announcement_created', doc._id, { audience: doc.audience, courseId: doc.courseId }, now);
  return { ok: true, status: 201, announcement: present(doc) };
}

async function editable(db, member, id) {
  if (!member || !['instructor', 'admin', 'superadmin'].includes(member.role)) return refuse(403, 'Not authorized');
  if (!isId(id)) return refuse(404, 'Announcement not found');
  const a = await db.collection('communityNews').findOne({ _id: new ObjectId(id), kind: KIND });
  if (!a) return refuse(404, 'Announcement not found');
  if (!isStaffAdmin(member) && String(a.createdBy) !== String(member.userId)) return refuse(404, 'Announcement not found');
  return { ok: true, announcement: a };
}

async function update(db, member, id, body, { now = new Date() } = {}) {
  const found = await editable(db, member, id);
  if (!found.ok) return found;
  if (found.announcement.status === 'archived') return refuse(409, 'An archived announcement cannot be edited.');
  const checked = await readAnnouncement(db, member, body, { now });
  if (!checked.ok) return checked;
  // A published announcement keeps its audience: changing who received it would be misleading.
  if (found.announcement.status === 'published' && (checked.fields.audience !== found.announcement.audience || checked.fields.courseId !== found.announcement.courseId)) return refuse(409, 'The audience of a published announcement cannot change. Archive it and create a new one.');
  await db.collection('communityNews').updateOne({ _id: found.announcement._id }, { $set: { ...checked.fields, updatedAt: now }, $inc: { version: 1 } });
  await audit(db, member, 'announcement_edited', found.announcement._id, { status: found.announcement.status }, now);
  return { ok: true, announcement: present({ ...found.announcement, ...checked.fields }) };
}

/**
 * Publishes now, or schedules when publishAt is in the future. Returns the notification for the
 * caller to deliver (lib/notifications.ts dedupes per recipient by key).
 */
async function publish(db, member, id, { now = new Date() } = {}) {
  const found = await editable(db, member, id);
  if (!found.ok) return found;
  const a = found.announcement;
  if (a.status === 'archived') return refuse(409, 'An archived announcement cannot be published.');
  if (a.status === 'published') return { ok: true, announcement: present(a), notify: null, repeated: true };
  if (a.publishAt && new Date(a.publishAt) > now) {
    await db.collection('communityNews').updateOne({ _id: a._id, status: a.status }, { $set: { status: 'scheduled', updatedAt: now } });
    await audit(db, member, 'announcement_scheduled', a._id, { publishAt: a.publishAt }, now);
    return { ok: true, announcement: present({ ...a, status: 'scheduled' }), notify: null };
  }
  return publishNow(db, a, member, now);
}

async function publishNow(db, a, actor, now) {
  const recipients = await recipientsFor(db, a);
  const won = await db.collection('communityNews').updateOne({ _id: a._id, status: { $in: ['draft', 'scheduled'] } }, { $set: { status: 'published', publishedAt: now, recipientCount: recipients.length, updatedAt: now } });
  if (!won.modifiedCount) return { ok: true, announcement: present(a), notify: null, repeated: true };
  await audit(db, actor, 'announcement_published', a._id, { audience: a.audience, courseId: a.courseId || null, recipients: recipients.length }, now);
  return {
    ok: true,
    announcement: present({ ...a, status: 'published', publishedAt: now, recipientCount: recipients.length }),
    notify: recipients.length ? { userIds: recipients, type: 'instructor_announcement', category: 'announcements', title: a.title, message: a.body.slice(0, 280), roleTarget: 'all', relatedId: String(a._id), dedupeKey: `announcement:${String(a._id)}`, metadata: { href: `/announcements#a-${String(a._id)}` } } : null,
  };
}

async function archive(db, member, id, { now = new Date() } = {}) {
  const found = await editable(db, member, id);
  if (!found.ok) return found;
  if (found.announcement.status === 'archived') return { ok: true };
  await db.collection('communityNews').updateOne({ _id: found.announcement._id }, { $set: { status: 'archived', archivedAt: now, updatedAt: now } });
  await audit(db, member, 'announcement_archived', found.announcement._id, { from: found.announcement.status }, now);
  return { ok: true };
}

/** Scheduled announcements that are due (worker). Returns the notifications to deliver. */
async function publishDue(db, { now = new Date(), limit = 10 } = {}) {
  const due = await db.collection('communityNews').find({ kind: KIND, status: 'scheduled', publishAt: { $lte: now } }).limit(limit).toArray();
  const out = [];
  for (const a of due) {
    const r = await publishNow(db, a, { userId: a.createdBy, role: 'system', email: null }, now);
    if (r.notify) out.push(r.notify);
  }
  return out;
}

/** What this member may read: published, unexpired, and addressed to them. */
async function visibleTo(db, member, { now = new Date(), page = 1 } = {}) {
  const or = [{ audience: 'all' }];
  if (member.role === 'student') or.push({ audience: 'students' });
  if (member.role === 'instructor') or.push({ audience: 'instructors' });
  const rows = await db.collection('progress').find({ userId: String(member.userId) }, { projection: { courseId: 1, active: 1, withdrawnAt: 1, progress: 1, completedAt: 1, userId: 1 } }).toArray();
  const courseIds = rows.filter(isActiveEnrollment).map((r) => String(r.courseId));
  if (member.role === 'instructor') {
    const taught = await db.collection('courses').find({ instructorId: { $in: [String(member.userId), new ObjectId(member.userId)] } }, { projection: { _id: 1 } }).toArray();
    courseIds.push(...taught.map((c) => String(c._id)));
  }
  if (member.role === 'admin' || member.role === 'superadmin') or.push({ audience: { $in: ['students', 'instructors', 'course'] } });
  else if (courseIds.length) or.push({ audience: 'course', courseId: { $in: [...new Set(courseIds)] } });
  const filter = { kind: KIND, status: 'published', $and: [{ $or: or }, { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] }] };
  const skip = (Math.max(1, page) - 1) * PAGE;
  const list = await db.collection('communityNews').find(filter).sort({ publishedAt: -1 }).skip(skip).limit(PAGE + 1).toArray();
  return { ok: true, announcements: list.slice(0, PAGE).map(present), hasMore: list.length > PAGE };
}

/** The author's (or, for admins, every) announcement, for the management screen. */
async function manageable(db, member, { status = '' } = {}) {
  if (!member || !['instructor', 'admin', 'superadmin'].includes(member.role)) return refuse(403, 'Not authorized');
  const filter = { kind: KIND };
  if (!isStaffAdmin(member)) filter.createdBy = String(member.userId);
  if (STATUSES.includes(status)) filter.status = status;
  const list = await db.collection('communityNews').find(filter).sort({ updatedAt: -1 }).limit(100).toArray();
  const courses = await db.collection('courses').find(member.role === 'instructor' ? { instructorId: { $in: [String(member.userId), new ObjectId(member.userId)] } } : {}, { projection: { title: 1 } }).limit(200).toArray();
  return { ok: true, announcements: list.map(present), courses: courses.map((c) => ({ id: String(c._id), title: c.title })), canAnnounceToAll: isStaffAdmin(member) };
}

module.exports = { AUDIENCES, KIND, archive, create, manageable, publish, publishDue, readAnnouncement, recipientsFor, update, visibleTo };

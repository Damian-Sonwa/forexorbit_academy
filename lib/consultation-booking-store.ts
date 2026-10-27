/**
 * Consultation booking persistence.
 * Extends consultationRequests. Does not delete chat sessions or course payments.
 * The slot uniqueness index is not created here.
 */

import { ObjectId, type Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { deliverNotification } from '@/lib/notifications';
import {
  ACTIVE_LIFECYCLES,
  bookingRole,
  buildSlots,
  canReadMeetingLink,
  decideAvailability,
  decideBookingAction,
  decideBookingDraft,
  hasOverlap,
  legacyStatus,
  normalizeLifecycle,
  paymentRequired,
  canPublishAvailability,
} from '@/lib/consultation-booking';

const REQUESTS = 'consultationRequests';
const SESSIONS = 'consultationSessions';

export class ConsultationBookingError extends Error {
  status: number;
  clientError: string;

  constructor(status: number, clientError: string) {
    super(clientError);
    this.status = status;
    this.clientError = clientError;
  }
}

type Member = { userId: string; role: string };

function reject(result: { ok: false; status: number; error: string }): never {
  throw new ConsultationBookingError(result.status, result.error);
}

function storedId(value: unknown) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

async function database() {
  return getDb();
}

async function notify(userId: string, title: string, message: string, dedupeKey: string, href = '/consultations') {
  if (!storedId(userId)) return;
  try {
    await deliverNotification({
      type: 'consultation_reminder',
      title,
      message,
      userId,
      dedupeKey,
      metadata: { href },
    });
  } catch {
    console.error(JSON.stringify({ event: 'consultationNotice', result: 'failed' }));
  }
}

export async function expireHolds(db?: Db, now = new Date()) {
  const databaseHandle = db || await database();
  await databaseHandle.collection(REQUESTS).updateMany(
    { lifecycle: 'PENDING_CONFIRMATION', holdExpiresAt: { $lt: now } },
    { $set: { lifecycle: 'CANCELLED', status: 'cancelled', cancelReason: 'expired', updatedAt: now } }
  );
}

function publicExpert(expert: Record<string, unknown>) {
  const schedule = expert.expertSchedule && typeof expert.expertSchedule === 'object'
    ? expert.expertSchedule as { timeZone?: string; durations?: number[]; focus?: string; windows?: unknown[] }
    : null;
  return {
    _id: String(expert._id),
    name: typeof expert.name === 'string' ? expert.name : 'Expert',
    profilePhoto: typeof expert.profilePhoto === 'string' ? expert.profilePhoto : null,
    expertAvailable: expert.expertAvailable !== false,
    timeZone: schedule && typeof schedule.timeZone === 'string' ? schedule.timeZone : null,
    durations: schedule && Array.isArray(schedule.durations) ? schedule.durations : [],
    focus: schedule && typeof schedule.focus === 'string' ? schedule.focus : '',
    hasAvailability: Boolean(schedule && Array.isArray(schedule.windows) && schedule.windows.length > 0),
  };
}

function ownSchedule(expert: Record<string, unknown>) {
  const schedule = expert.expertSchedule;
  if (!schedule || typeof schedule !== 'object') return null;
  const row = schedule as { timeZone?: unknown; durations?: unknown; bufferMinutes?: unknown; focus?: unknown; windows?: unknown };
  return {
    timeZone: typeof row.timeZone === 'string' ? row.timeZone : null,
    durations: Array.isArray(row.durations) ? row.durations.filter((minutes) => minutes === 30 || minutes === 60) : [],
    bufferMinutes: [0, 5, 10, 15].includes(Number(row.bufferMinutes)) ? Number(row.bufferMinutes) : 0,
    focus: typeof row.focus === 'string' ? row.focus : '',
    windows: Array.isArray(row.windows) ? row.windows : [],
  };
}

export async function listExperts(viewerId?: string) {
  const db = await database();
  const experts = await db.collection('users').find({
    isExpert: true,
    role: { $in: ['instructor', 'admin', 'superadmin'] },
  }).project({
    name: 1,
    profilePhoto: 1,
    expertAvailable: 1,
    expertSchedule: 1,
  }).toArray();
  return experts.map((expert) => {
    const card = publicExpert(expert);
    if (viewerId && String(expert._id) === viewerId) return { ...card, schedule: ownSchedule(expert) };
    return card;
  });
}

export async function saveAvailability(member: Member, body: unknown) {
  const decision = decideAvailability(body);
  if (!decision.ok) reject(decision);
  const db = await database();
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(member.userId) },
    { projection: { isExpert: 1, role: 1 } }
  );
  const gate = canPublishAvailability(member, { isExpert: user?.isExpert === true }, 'publish');
  if (!gate.ok) throw new ConsultationBookingError(gate.status, gate.error);
  const update: Record<string, unknown> = { expertSchedule: decision.schedule, updatedAt: new Date() };
  if (gate.markExpert) update.isExpert = true;
  await db.collection('users').updateOne(
    { _id: new ObjectId(member.userId) },
    { $set: update }
  );
  console.log(JSON.stringify({ event: 'consultationAvailability', actorId: member.userId, result: 'ok' }));
  return { success: true, published: true };
}

export async function setAvailableFlag(member: Member, available: boolean) {
  if (typeof available !== 'boolean') throw new ConsultationBookingError(400, 'Available must be a boolean.');
  const db = await database();
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(member.userId) },
    { projection: { isExpert: 1 } }
  );
  const gate = canPublishAvailability(member, { isExpert: user?.isExpert === true }, 'pause');
  if (!gate.ok) throw new ConsultationBookingError(gate.status, gate.error);
  await db.collection('users').updateOne(
    { _id: new ObjectId(member.userId) },
    { $set: { expertAvailable: available } }
  );
  return { success: true, expertAvailable: available };
}

async function activeBookings(db: Db, expertId: string) {
  return db.collection(REQUESTS).find({
    expertId,
    $or: [
      { lifecycle: { $in: ACTIVE_LIFECYCLES } },
      { lifecycle: { $exists: false }, status: { $in: ['pending', 'accepted'] } },
    ],
  }).toArray();
}

export async function listSlots(expertId: string, from: unknown, to: unknown, now = new Date()) {
  if (!storedId(expertId)) throw new ConsultationBookingError(400, 'Choose an expert.');
  const db = await database();
  await expireHolds(db, now);
  const expert = await db.collection('users').findOne(
    { _id: new ObjectId(expertId), isExpert: true },
    { projection: { expertAvailable: 1, expertSchedule: 1 } }
  );
  if (!expert) throw new ConsultationBookingError(404, 'Expert not found.');
  if (expert.expertAvailable === false || !expert.expertSchedule) return [];
  const start = new Date(typeof from === 'string' ? from : now);
  const end = new Date(typeof to === 'string' ? to : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ConsultationBookingError(400, 'Choose a valid date range.');
  }
  const bookings = await activeBookings(db, expertId);
  return buildSlots({
    schedule: expert.expertSchedule,
    rangeStart: start,
    rangeEnd: end,
    bookings,
    now,
  });
}

async function consultationEnabled(db: Db) {
  const disabled = await db.collection('users').findOne(
    { role: 'superadmin', consultationEnabled: false },
    { projection: { _id: 1 } }
  );
  return !disabled;
}

export async function createBooking(member: Member, body: unknown, now = new Date()) {
  if (member.role !== 'student') throw new ConsultationBookingError(403, 'Only a learner can book a consultation.');
  if (paymentRequired()) throw new ConsultationBookingError(409, 'Payment is not configured for consultations.');
  const db = await database();
  if (!(await consultationEnabled(db))) throw new ConsultationBookingError(400, 'Consultations are currently turned off.');
  await expireHolds(db, now);
  const expertId = body && typeof body === 'object' && 'expertId' in body ? String((body as { expertId?: string }).expertId || '') : '';
  if (!storedId(expertId)) throw new ConsultationBookingError(400, 'Choose an expert.');
  const expert = await db.collection('users').findOne(
    { _id: new ObjectId(expertId) },
    { projection: { isExpert: 1, expertAvailable: 1, expertSchedule: 1, role: 1 } }
  );
  if (!expert?.isExpert) throw new ConsultationBookingError(404, 'Expert not found.');
  if (expert.expertAvailable === false) throw new ConsultationBookingError(400, 'This expert is not taking consultations.');
  if (!expert.expertSchedule) throw new ConsultationBookingError(400, 'This expert has not published availability.');
  const bookings = await activeBookings(db, expertId);
  const draft = decideBookingDraft(body, expert.expertSchedule, bookings, now);
  if (!draft.ok) reject(draft);
  if (hasOverlap(draft, bookings, undefined, expert.expertSchedule.bufferMinutes)) {
    throw new ConsultationBookingError(409, 'That time is no longer available.');
  }
  const request = {
    studentId: member.userId,
    expertId: draft.expertId,
    topic: draft.topic,
    description: draft.description,
    consultationType: 'external-meeting',
    status: 'pending',
    lifecycle: 'PENDING_CONFIRMATION',
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    durationMinutes: draft.durationMinutes,
    slotKey: draft.slotKey,
    holdExpiresAt: draft.holdExpiresAt,
    paymentStatus: 'not_required',
    amount: null,
    currency: null,
    meetingUrl: null,
    meetingProvider: null,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection(REQUESTS).insertOne(request);
  const conflict = await db.collection(REQUESTS).findOne({
    expertId: draft.expertId,
    _id: { $ne: result.insertedId, $lt: result.insertedId },
    startsAt: { $lt: draft.endsAt },
    endsAt: { $gt: draft.startsAt },
    $or: [
      { lifecycle: { $in: ACTIVE_LIFECYCLES } },
      { lifecycle: { $exists: false }, status: { $in: ['pending', 'accepted'] } },
    ],
  });
  if (conflict) {
    await db.collection(REQUESTS).deleteOne({ _id: result.insertedId, lifecycle: 'PENDING_CONFIRMATION' });
    throw new ConsultationBookingError(409, 'That time is no longer available.');
  }
  await notify(draft.expertId, 'New consultation request', 'A learner booked a consultation with you.', `consultation:${String(result.insertedId)}:requested`, '/consultations/expert');
  console.log(JSON.stringify({ event: 'consultationBooking', action: 'create', bookingId: String(result.insertedId), result: 'ok' }));
  return { success: true, request: { ...request, _id: String(result.insertedId), meetingUrl: null } };
}

function present(booking: Record<string, unknown>, member: Member, people: { student?: Record<string, unknown> | null; expert?: Record<string, unknown> | null }, now = new Date()) {
  const linkVisible = canReadMeetingLink(member, booking as { studentId?: string; expertId?: string; lifecycle?: string; meetingUrl?: string; startsAt?: Date }, now);
  const role = bookingRole(member, booking as { studentId?: string; expertId?: string });
  const person = (user: Record<string, unknown> | null | undefined, includeEmail: boolean) => {
    if (!user) return null;
    return {
      _id: String(user._id),
      name: typeof user.name === 'string' ? user.name : 'Member',
      profilePhoto: typeof user.profilePhoto === 'string' ? user.profilePhoto : null,
      email: includeEmail && typeof user.email === 'string' ? user.email : undefined,
    };
  };
  return {
    _id: String(booking._id),
    studentId: booking.studentId,
    expertId: booking.expertId,
    topic: booking.topic,
    description: booking.description,
    consultationType: booking.consultationType,
    status: booking.status,
    lifecycle: normalizeLifecycle(booking as { lifecycle?: string; status?: string }),
    startsAt: booking.startsAt || null,
    endsAt: booking.endsAt || null,
    durationMinutes: booking.durationMinutes || null,
    paymentStatus: booking.paymentStatus || 'not_required',
    amount: null,
    meetingReady: typeof booking.meetingUrl === 'string' && booking.meetingUrl.length > 0,
    meetingUrl: linkVisible ? booking.meetingUrl : null,
    meetingProvider: linkVisible ? booking.meetingProvider : null,
    proposedStartsAt: booking.proposedStartsAt || null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    student: person(people.student, role === 'expert' || role === 'admin'),
    expert: person(people.expert, role === 'admin'),
  };
}

async function peopleFor(db: Db, bookings: Array<Record<string, unknown>>) {
  const ids = Array.from(new Set(bookings.flatMap((booking) => [booking.studentId, booking.expertId]).filter((id) => storedId(id)).map(String)));
  const users = ids.length
    ? await db.collection('users').find(
      { _id: { $in: ids.map((id) => new ObjectId(id)) } },
      { projection: { name: 1, email: 1, profilePhoto: 1 } }
    ).toArray()
    : [];
  const map = new Map(users.map((user) => [String(user._id), user]));
  return (booking: Record<string, unknown>) => ({
    student: map.get(String(booking.studentId)) || null,
    expert: map.get(String(booking.expertId)) || null,
  });
}

export async function listBookings(member: Member, now = new Date()) {
  const db = await database();
  await expireHolds(db, now);
  const query = member.role === 'student'
    ? { studentId: member.userId }
    : member.role === 'instructor'
      ? { expertId: member.userId }
      : member.role === 'admin' || member.role === 'superadmin'
        ? {}
        : null;
  if (!query) throw new ConsultationBookingError(403, 'You cannot view consultations.');
  const bookings = await db.collection(REQUESTS).find(query).sort({ createdAt: -1 }).limit(100).toArray();
  const lookup = await peopleFor(db, bookings);
  return bookings.map((booking) => present(booking, member, lookup(booking), now));
}

export async function getBooking(member: Member, id: string, now = new Date()) {
  if (!storedId(id)) throw new ConsultationBookingError(400, 'That consultation could not be found.');
  const db = await database();
  const booking = await db.collection(REQUESTS).findOne({ _id: new ObjectId(id) });
  if (!booking) throw new ConsultationBookingError(404, 'That consultation could not be found.');
  if (bookingRole(member, { studentId: String(booking.studentId || ''), expertId: String(booking.expertId || '') }) === 'none') throw new ConsultationBookingError(403, 'You cannot view this consultation.');
  const lookup = await peopleFor(db, [booking]);
  return present(booking, member, lookup(booking), now);
}

async function ensureSession(db: Db, booking: Record<string, unknown>, scheduled: boolean) {
  const existing = await db.collection(SESSIONS).findOne({ requestId: String(booking._id) });
  if (existing) return existing;
  const now = new Date();
  const session = {
    requestId: String(booking._id),
    studentId: booking.studentId,
    expertId: booking.expertId,
    topic: booking.topic,
    consultationType: booking.consultationType || 'external-meeting',
    messages: [],
    startedAt: scheduled && booking.startsAt ? booking.startsAt : now,
    endedAt: null,
    status: scheduled ? 'scheduled' : 'active',
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection(SESSIONS).insertOne(session);
  return { ...session, _id: result.insertedId };
}

export async function actOnBooking(member: Member, id: string, body: unknown, now = new Date()) {
  if (!storedId(id)) throw new ConsultationBookingError(400, 'That consultation could not be found.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ConsultationBookingError(400, 'That action is not available.');
  const payload = body as { action?: string; reason?: string; meetingUrl?: string; startsAt?: string; durationMinutes?: number };
  const action = payload.action === 'reject' ? 'decline' : payload.action;
  if (typeof action !== 'string') throw new ConsultationBookingError(400, 'That action is not available.');
  const db = await database();
  const booking = await db.collection(REQUESTS).findOne({ _id: new ObjectId(id) });
  if (!booking) throw new ConsultationBookingError(404, 'That consultation could not be found.');
  let proposed: { startsAt: Date; endsAt: Date; durationMinutes: number } | undefined;
  if (action === 'request-reschedule' || action === 'accept-reschedule') {
    const expert = await db.collection('users').findOne(
      { _id: new ObjectId(String(booking.expertId)) },
      { projection: { expertSchedule: 1 } }
    );
    const schedule = expert?.expertSchedule;
    if (!schedule) throw new ConsultationBookingError(400, 'This expert has not published availability.');
    const targetStart = action === 'accept-reschedule' ? booking.proposedStartsAt : payload.startsAt;
    const duration = action === 'accept-reschedule' ? booking.durationMinutes : payload.durationMinutes;
    const bookings = await activeBookings(db, String(booking.expertId));
    const draft = decideBookingDraft({
      expertId: String(booking.expertId),
      topic: booking.topic,
      description: booking.description,
      startsAt: targetStart,
      durationMinutes: duration,
    }, schedule, bookings.filter((item) => String(item._id) !== String(booking._id)), now);
    if (!draft.ok) reject(draft);
    if (hasOverlap(draft, bookings, String(booking._id), schedule.bufferMinutes)) {
      throw new ConsultationBookingError(409, 'That time is no longer available.');
    }
    proposed = { startsAt: draft.startsAt, endsAt: draft.endsAt, durationMinutes: draft.durationMinutes };
  }
  const decision = decideBookingAction({
    member,
    booking,
    action,
    now,
    proposed,
    reason: payload.reason,
    meetingUrl: payload.meetingUrl,
  });
  if (!decision.ok) reject(decision);
  const update: Record<string, unknown> = {
    lifecycle: decision.lifecycle,
    status: legacyStatus(decision.lifecycle, decision.reason),
    updatedAt: now,
  };
  if (decision.lifecycle === 'CANCELLED') update.cancelReason = decision.reason || 'cancelled';
  if (decision.lifecycle === 'RESCHEDULE_REQUESTED' && proposed) {
    update.proposedStartsAt = proposed.startsAt;
    update.proposedEndsAt = proposed.endsAt;
  }
  if (action === 'accept-reschedule' && proposed) {
    update.startsAt = proposed.startsAt;
    update.endsAt = proposed.endsAt;
    update.durationMinutes = proposed.durationMinutes;
    update.slotKey = String(booking.expertId) + ':' + proposed.startsAt.toISOString();
    update.proposedStartsAt = null;
    update.proposedEndsAt = null;
    update.meetingUrl = null;
    update.meetingProvider = null;
  }
  if (decision.meeting) {
    update.meetingUrl = decision.meeting.meetingUrl;
    update.meetingProvider = decision.meeting.provider;
  }
  await db.collection(REQUESTS).updateOne({ _id: booking._id }, { $set: update });
  if (action === 'accept') {
    await ensureSession(db, booking, Boolean(booking.startsAt));
    await notify(String(booking.studentId), 'Consultation confirmed', 'Your consultation was confirmed.', `consultation:${id}:confirmed`);
  } else if (action === 'decline' || action === 'cancel') {
    const recipient = bookingRole(member, { studentId: String(booking.studentId || ''), expertId: String(booking.expertId || '') }) === 'learner' ? String(booking.expertId) : String(booking.studentId);
    const href = recipient === String(booking.expertId) ? '/consultations/expert' : '/consultations';
    await notify(recipient, 'Consultation cancelled', 'A consultation was cancelled.', `consultation:${id}:${action}`, href);
  } else if (decision.meeting) {
    await notify(String(booking.studentId), 'Meeting link ready', 'The meeting link for your consultation is ready in your consultation list.', `consultation:${id}:meeting`);
  } else if (action === 'request-reschedule') {
    await notify(String(booking.expertId), 'Reschedule requested', 'A learner asked to move a consultation.', `consultation:${id}:reschedule`, '/consultations/expert');
  }
  console.log(JSON.stringify({ event: 'consultationBooking', action, bookingId: id, result: 'ok' }));
  return { success: true, lifecycle: decision.lifecycle, sessionId: action === 'accept' ? String((await db.collection(SESSIONS).findOne({ requestId: id }))?._id || '') : undefined };
}

export async function sendDueReminders(member: Member, now = new Date()) {
  if (member.role !== 'admin' && member.role !== 'superadmin') {
    throw new ConsultationBookingError(403, 'You cannot run consultation reminders.');
  }
  const db = await database();
  const soon = new Date(now.getTime() + 60 * 60 * 1000);
  const due = await db.collection(REQUESTS).find({
    lifecycle: 'CONFIRMED',
    startsAt: { $gte: now, $lte: soon },
    reminderSentAt: { $exists: false },
  }).limit(50).toArray();
  let sent = 0;
  for (const booking of due) {
    const claimed = await db.collection(REQUESTS).updateOne(
      { _id: booking._id, reminderSentAt: { $exists: false } },
      { $set: { reminderSentAt: now } }
    );
    if (claimed.modifiedCount !== 1) continue;
    await notify(String(booking.studentId), 'Consultation soon', 'You have a consultation in the next hour.', `consultation:${String(booking._id)}:reminder:${new Date(booking.startsAt).toISOString()}`);
    await notify(String(booking.expertId), 'Consultation soon', 'You have a consultation in the next hour.', `consultation:${String(booking._id)}:reminder-expert:${new Date(booking.startsAt).toISOString()}`, '/consultations/expert');
    sent += 1;
  }
  return { sent };
}

/**
 * Consultation booking rules.
 * Meetings are external Google Meet or Zoom links. This module does not
 * create meetings or charge a price. Existing chat sessions stay separate.
 * Authors of a booking cannot set payment or completion status directly.
 */

const ACTIVE_LIFECYCLES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'RESCHEDULE_REQUESTED'];
const DURATIONS = new Set([30, 60]);
const BUFFERS = new Set([0, 5, 10, 15]);
const HOLD_MS = 24 * 60 * 60 * 1000;
const CANCEL_CUTOFF_MS = 60 * 60 * 1000;
const SLOT_RANGE_MS = 14 * 24 * 60 * 60 * 1000;
const CUTOFF_MS = 15 * 60 * 1000;

const LEGACY_LIFECYCLE = {
  pending: 'PENDING_CONFIRMATION',
  accepted: 'CONFIRMED',
  rejected: 'CANCELLED',
  cancelled: 'CANCELLED',
  completed: 'COMPLETED',
};

function fail(status, error) {
  return { ok: false, status, error };
}

function isStoredId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function plainText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function normalizeLifecycle(record) {
  const named = record && typeof record.lifecycle === 'string' ? record.lifecycle : '';
  if (named) return named;
  const legacy = record && typeof record.status === 'string' ? record.status : '';
  return LEGACY_LIFECYCLE[legacy] || 'PENDING_CONFIRMATION';
}

function legacyStatus(lifecycle, reason) {
  if (lifecycle === 'PENDING_CONFIRMATION') return 'pending';
  if (lifecycle === 'CONFIRMED' || lifecycle === 'RESCHEDULE_REQUESTED') return 'accepted';
  if (lifecycle === 'COMPLETED' || lifecycle === 'NO_SHOW') return 'completed';
  if (reason === 'declined') return 'rejected';
  return 'cancelled';
}

function isModerator(role) {
  return role === 'admin' || role === 'superadmin';
}

function sameUser(left, right) {
  return String(left || '') === String(right || '');
}

function bookingRole(member, booking) {
  if (!member || !booking) return 'none';
  if (isModerator(member.role)) return 'admin';
  if (sameUser(member.userId, booking.expertId)) return 'expert';
  if (sameUser(member.userId, booking.studentId)) return 'learner';
  return 'none';
}

function canReadMeetingLink(member, booking, now) {
  const role = bookingRole(member, booking);
  if (role === 'none') return false;
  if (normalizeLifecycle(booking) !== 'CONFIRMED') return false;
  if (typeof booking.meetingUrl !== 'string' || !booking.meetingUrl) return false;
  const start = booking.startsAt instanceof Date ? booking.startsAt : new Date(booking.startsAt);
  if (Number.isNaN(start.getTime())) return false;
  const current = now instanceof Date ? now : new Date(now || Date.now());
  if (current.getTime() > start.getTime() + 3 * 60 * 60 * 1000) return false;
  return true;
}

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseClock(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map((part) => Number(part));
  return hour * 60 + minute;
}

function decideAvailability(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'Check the availability and try again.');
  }
  const timeZone = body.timeZone;
  if (!validTimeZone(timeZone)) return fail(400, 'Choose a valid timezone.');
  const durations = Array.isArray(body.durations) ? body.durations.filter((item) => DURATIONS.has(item)) : [];
  if (durations.length === 0 || durations.length > 2) return fail(400, 'Choose a 30 or 60 minute session.');
  const buffer = BUFFERS.has(body.bufferMinutes) ? body.bufferMinutes : null;
  if (buffer == null) return fail(400, 'Choose a buffer of 0, 5, 10, or 15 minutes.');
  const focus = plainText(body.focus, 280);
  const windows = Array.isArray(body.windows) ? body.windows : null;
  if (!windows || windows.length === 0 || windows.length > 14) {
    return fail(400, 'Add at least one weekly time window.');
  }
  const clean = [];
  for (const window of windows) {
    const weekday = window && window.weekday;
    const start = parseClock(window && window.start);
    const end = parseClock(window && window.end);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || start == null || end == null || end - start < 30) {
      return fail(400, 'Each window needs a weekday and a start time before the end time.');
    }
    clean.push({
      weekday,
      start: window.start,
      end: window.end,
    });
  }
  return {
    ok: true,
    schedule: {
      timeZone,
      durations: Array.from(new Set(durations)),
      bufferMinutes: buffer,
      focus,
      windows: clean,
    },
  };
}

function zoneOffsetMs(instant, timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  format.formatToParts(instant).forEach((part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
  });
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtc - instant.getTime();
}

function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = zoneOffsetMs(guess, timeZone);
  const adjusted = new Date(guess.getTime() - first);
  const second = zoneOffsetMs(adjusted, timeZone);
  return new Date(guess.getTime() - second);
}

function zoneParts(instant, timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = {};
  format.formatToParts(instant).forEach((part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
  });
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  return {
    weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function overlaps(startA, endA, startB, endB) {
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

function occupiedRange(booking, bufferMinutes) {
  const start = new Date(booking.startsAt);
  const end = new Date(booking.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const buffer = BUFFERS.has(bufferMinutes) ? bufferMinutes : 0;
  return { start, end: new Date(end.getTime() + buffer * 60 * 1000) };
}

function buildSlots({ schedule, rangeStart, rangeEnd, bookings, now }) {
  if (!schedule || !validTimeZone(schedule.timeZone) || !Array.isArray(schedule.windows)) return [];
  const start = rangeStart instanceof Date ? rangeStart : new Date(rangeStart);
  const end = rangeEnd instanceof Date ? rangeEnd : new Date(rangeEnd);
  const current = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
  const limitedEnd = new Date(Math.min(end.getTime(), start.getTime() + SLOT_RANGE_MS));
  const earliest = current.getTime() + CUTOFF_MS;
  const taken = (Array.isArray(bookings) ? bookings : [])
    .filter((booking) => ACTIVE_LIFECYCLES.includes(normalizeLifecycle(booking)))
    .map((booking) => occupiedRange(booking, schedule.bufferMinutes))
    .filter(Boolean);
  const slots = [];
  const cursor = new Date(start.getTime());
  while (cursor < limitedEnd) {
    const parts = zoneParts(cursor, schedule.timeZone);
    const dayStart = zonedToUtc(parts.year, parts.month, parts.day, 0, 0, schedule.timeZone);
    schedule.windows.filter((window) => window.weekday === parts.weekday).forEach((window) => {
      const open = parseClock(window.start);
      const close = parseClock(window.end);
      schedule.durations.forEach((duration) => {
        if (!DURATIONS.has(duration) || open == null || close == null) return;
        for (let minute = open; minute + duration <= close; minute += duration) {
          const slotStart = zonedToUtc(parts.year, parts.month, parts.day, Math.floor(minute / 60), minute % 60, schedule.timeZone);
          const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
          if (slotStart.getTime() < earliest || slotEnd > limitedEnd) continue;
          const blocked = taken.some((range) => overlaps(slotStart, slotEnd, range.start, range.end));
          if (!blocked) slots.push({ startsAt: slotStart.toISOString(), endsAt: slotEnd.toISOString(), durationMinutes: duration });
        }
      });
    });
    const next = dayStart.getTime() + 24 * 60 * 60 * 1000;
    if (next <= cursor.getTime()) break;
    cursor.setTime(next);
    if (slots.length > 200) break;
  }
  const unique = new Map();
  slots.forEach((slot) => unique.set(slot.startsAt + ':' + slot.durationMinutes, slot));
  return Array.from(unique.values()).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

function decideBookingDraft(body, schedule, bookings, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Check the booking and try again.');
  if (!isStoredId(body.expertId)) return fail(400, 'Choose an expert.');
  const topic = plainText(body.topic, 120);
  const description = plainText(body.description, 2000);
  if (topic.length < 3) return fail(400, 'Add a short topic.');
  if (description.length < 10) return fail(400, 'Describe what you want to cover.');
  const startsAt = new Date(body.startsAt);
  const duration = Number(body.durationMinutes);
  if (Number.isNaN(startsAt.getTime()) || !DURATIONS.has(duration)) return fail(400, 'Choose an available time.');
  const rangeEnd = new Date(startsAt.getTime() + duration * 60 * 1000 + 60 * 1000);
  const slots = buildSlots({
    schedule,
    rangeStart: new Date(startsAt.getTime() - 60 * 1000),
    rangeEnd,
    bookings,
    now,
  });
  const match = slots.find((slot) => slot.startsAt === startsAt.toISOString() && slot.durationMinutes === duration);
  if (!match) return fail(409, 'That time is no longer available.');
  return {
    ok: true,
    expertId: body.expertId,
    topic,
    description,
    startsAt,
    endsAt: new Date(match.endsAt),
    durationMinutes: duration,
    slotKey: body.expertId + ':' + startsAt.toISOString(),
    holdExpiresAt: new Date((now instanceof Date ? now : new Date(now || Date.now())).getTime() + HOLD_MS),
  };
}

function hasOverlap(candidate, bookings, ignoreId, bufferMinutes) {
  const start = new Date(candidate.startsAt);
  const end = new Date(candidate.endsAt);
  return (Array.isArray(bookings) ? bookings : []).some((booking) => {
    if (ignoreId && String(booking._id) === String(ignoreId)) return false;
    if (!ACTIVE_LIFECYCLES.includes(normalizeLifecycle(booking))) return false;
    const range = occupiedRange(booking, bufferMinutes);
    if (!range) return false;
    return overlaps(start, end, range.start, range.end);
  });
}

function decideMeetingUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return fail(400, 'Enter a Google Meet or Zoom link.');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return fail(400, 'Enter a Google Meet or Zoom link.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) return fail(400, 'Enter a Google Meet or Zoom link.');
  const host = url.hostname.toLowerCase();
  const meet = host === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(url.pathname);
  const zoom = (host === 'zoom.us' || host.endsWith('.zoom.us')) && /^\/j\/[A-Za-z0-9]+/.test(url.pathname);
  if (!meet && !zoom) return fail(400, 'Enter a Google Meet or Zoom link.');
  return { ok: true, meetingUrl: url.toString(), provider: meet ? 'google-meet' : 'zoom' };
}

function decideBookingAction({ member, booking, action, now, proposed, reason, meetingUrl }) {
  const role = bookingRole(member, booking);
  if (role === 'none') return fail(403, 'You cannot change this consultation.');
  const lifecycle = normalizeLifecycle(booking);
  const current = now instanceof Date ? now : new Date(now || Date.now());
  const start = booking.startsAt ? new Date(booking.startsAt) : null;
  const started = start && !Number.isNaN(start.getTime()) && current.getTime() >= start.getTime();

  if (action === 'accept') {
    if (role === 'learner') return fail(403, 'You cannot change this consultation.');
    if (lifecycle !== 'PENDING_CONFIRMATION') return fail(409, 'This consultation can no longer be accepted.');
    return { ok: true, lifecycle: 'CONFIRMED', reason: '' };
  }
  if (action === 'decline') {
    if (role === 'learner') return fail(403, 'You cannot change this consultation.');
    if (lifecycle !== 'PENDING_CONFIRMATION') return fail(409, 'This consultation can no longer be declined.');
    return { ok: true, lifecycle: 'CANCELLED', reason: 'declined' };
  }
  if (action === 'cancel') {
    if (lifecycle !== 'PENDING_CONFIRMATION' && lifecycle !== 'CONFIRMED' && lifecycle !== 'RESCHEDULE_REQUESTED') {
      return fail(409, 'This consultation can no longer be cancelled.');
    }
    if (role === 'learner' && lifecycle !== 'PENDING_CONFIRMATION') {
      if (!start || Number.isNaN(start.getTime()) || start.getTime() - current.getTime() < CANCEL_CUTOFF_MS) {
        return fail(409, 'This consultation is too close to its start time to cancel here.');
      }
    }
    if ((role === 'expert' || role === 'admin') && started && lifecycle === 'CONFIRMED') {
      return fail(409, 'Use completed or no-show after the start time.');
    }
    return { ok: true, lifecycle: 'CANCELLED', reason: plainText(reason, 280) || 'cancelled' };
  }
  if (action === 'complete' || action === 'no-show') {
    if (role === 'learner') return fail(403, 'You cannot change this consultation.');
    if (lifecycle !== 'CONFIRMED') return fail(409, 'Only a confirmed consultation can be closed.');
    if (start && !Number.isNaN(start.getTime()) && !started) return fail(409, 'This consultation has not started.');
    return { ok: true, lifecycle: action === 'complete' ? 'COMPLETED' : 'NO_SHOW', reason: '' };
  }
  if (action === 'request-reschedule') {
    if (role === 'admin') return fail(403, 'Ask the learner or expert to propose the new time.');
    if (lifecycle !== 'CONFIRMED' && lifecycle !== 'PENDING_CONFIRMATION') {
      return fail(409, 'This consultation can no longer be rescheduled.');
    }
    if (!proposed || !proposed.startsAt) return fail(400, 'Choose a new time.');
    return { ok: true, lifecycle: 'RESCHEDULE_REQUESTED', proposed };
  }
  if (action === 'accept-reschedule') {
    if (role === 'learner') return fail(403, 'You cannot change this consultation.');
    if (lifecycle !== 'RESCHEDULE_REQUESTED' || !booking.proposedStartsAt) {
      return fail(409, 'There is no new time to accept.');
    }
    return { ok: true, lifecycle: 'CONFIRMED', proposed: { startsAt: booking.proposedStartsAt, endsAt: booking.proposedEndsAt, durationMinutes: booking.durationMinutes } };
  }
  if (action === 'meeting') {
    if (role === 'learner') return fail(403, 'You cannot change this consultation.');
    if (lifecycle !== 'CONFIRMED') return fail(409, 'Add the meeting link after the consultation is confirmed.');
    const link = decideMeetingUrl(meetingUrl);
    if (!link.ok) return link;
    return { ok: true, lifecycle, meeting: link };
  }
  return fail(400, 'That action is not available.');
}

function canPublishAvailability(member, record, mode) {
  const role = member && member.role;
  if (role !== 'instructor' && role !== 'admin' && role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Only an expert can update availability.', markExpert: false };
  }
  if (record && record.isExpert === true) return { ok: true, markExpert: false };
  if (mode === 'publish' && role === 'superadmin') return { ok: true, markExpert: true };
  if (role === 'superadmin') {
    return { ok: false, status: 400, error: 'Publish your weekly hours before changing whether you are taking bookings.', markExpert: false };
  }
  return { ok: false, status: 403, error: 'A super admin must approve you as an expert before you can publish times.', markExpert: false };
}

function paymentRequired() {
  return false;
}

module.exports = {
  ACTIVE_LIFECYCLES,
  HOLD_MS,
  CANCEL_CUTOFF_MS,
  normalizeLifecycle,
  legacyStatus,
  bookingRole,
  canReadMeetingLink,
  decideAvailability,
  buildSlots,
  decideBookingDraft,
  hasOverlap,
  decideMeetingUrl,
  decideBookingAction,
  canPublishAvailability,
  paymentRequired,
  zonedToUtc,
  overlaps,
};

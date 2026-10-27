/**
 * Consultation booking rules. No database connection and no payment call.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decideAvailability,
  buildSlots,
  decideBookingDraft,
  hasOverlap,
  decideMeetingUrl,
  decideBookingAction,
  canReadMeetingLink,
  paymentRequired,
  canPublishAvailability,
  normalizeLifecycle,
} = require('../lib/consultation-booking');
const { isFeatureApiBlocked, FEATURES } = require('../lib/feature-access');

const LEARNER = '507f1f77bcf86cd799439011';
const EXPERT = '507f1f77bcf86cd799439012';
const OTHER = '507f1f77bcf86cd799439013';
const BOOKING = '507f1f77bcf86cd799439014';
const learner = { userId: LEARNER, role: 'student' };
const expert = { userId: EXPERT, role: 'instructor' };
const outsider = { userId: OTHER, role: 'student' };
const admin = { userId: OTHER, role: 'admin' };

const schedule = {
  timeZone: 'UTC',
  durations: [30],
  bufferMinutes: 0,
  focus: 'Chart review',
  windows: [{ weekday: 1, start: '10:00', end: '11:00' }],
};

function mondaySlot() {
  const now = new Date('2026-11-01T00:00:00.000Z');
  const slots = buildSlots({
    schedule,
    rangeStart: new Date('2026-11-02T00:00:00.000Z'),
    rangeEnd: new Date('2026-11-03T00:00:00.000Z'),
    bookings: [],
    now,
  });
  return { now, slots };
}

test('weekly availability rejects an overnight or unknown duration', () => {
  const saved = decideAvailability({
    timeZone: 'UTC',
    durations: [30, 60],
    bufferMinutes: 10,
    focus: 'Risk and review',
    windows: [{ weekday: 1, start: '09:00', end: '12:00' }],
  });
  const overnight = decideAvailability({
    timeZone: 'UTC',
    durations: [30],
    bufferMinutes: 0,
    windows: [{ weekday: 1, start: '22:00', end: '02:00' }],
  });
  assert.equal(saved.ok, true);
  assert.equal(overnight.ok, false);
});

test('open slots follow the expert timezone and skip occupied times', () => {
  const { now, slots } = mondaySlot();
  assert.deepEqual(slots.map((slot) => slot.startsAt), [
    '2026-11-02T10:00:00.000Z',
    '2026-11-02T10:30:00.000Z',
  ]);
  const blocked = buildSlots({
    schedule,
    rangeStart: new Date('2026-11-02T00:00:00.000Z'),
    rangeEnd: new Date('2026-11-03T00:00:00.000Z'),
    bookings: [{
      lifecycle: 'CONFIRMED',
      startsAt: '2026-11-02T10:00:00.000Z',
      endsAt: '2026-11-02T10:30:00.000Z',
    }],
    now,
  });
  assert.deepEqual(blocked.map((slot) => slot.startsAt), ['2026-11-02T10:30:00.000Z']);
});

test('a booking must match a free future slot and ignores a client price', () => {
  const { now, slots } = mondaySlot();
  const draft = decideBookingDraft({
    expertId: EXPERT,
    topic: 'EURUSD trend',
    description: 'I want to review the last swing and my invalidation.',
    startsAt: slots[0].startsAt,
    durationMinutes: 30,
    amount: 5000,
    paymentStatus: 'paid',
  }, schedule, [], now);
  const taken = decideBookingDraft({
    expertId: EXPERT,
    topic: 'EURUSD trend',
    description: 'I want to review the last swing and my invalidation.',
    startsAt: slots[0].startsAt,
    durationMinutes: 30,
  }, schedule, [{ lifecycle: 'PENDING_CONFIRMATION', startsAt: slots[0].startsAt, endsAt: slots[0].endsAt }], now);
  const past = decideBookingDraft({
    expertId: EXPERT,
    topic: 'EURUSD trend',
    description: 'I want to review the last swing and my invalidation.',
    startsAt: '2020-01-01T10:00:00.000Z',
    durationMinutes: 30,
  }, schedule, [], now);
  assert.equal(draft.ok, true);
  if (draft.ok) {
    assert.equal(draft.slotKey, EXPERT + ':' + slots[0].startsAt);
    assert.equal('amount' in draft, false);
  }
  assert.equal(taken.ok, false);
  assert.equal(past.ok, false);
  assert.equal(hasOverlap(
    { startsAt: slots[0].startsAt, endsAt: slots[0].endsAt },
    [{ _id: 'keep', lifecycle: 'CONFIRMED', startsAt: slots[0].startsAt, endsAt: slots[0].endsAt }],
    'keep'
  ), false);
  assert.equal(hasOverlap(
    { startsAt: slots[0].startsAt, endsAt: slots[0].endsAt },
    [{ _id: 'other', lifecycle: 'CONFIRMED', startsAt: slots[0].startsAt, endsAt: slots[0].endsAt }]
  ), true);
});

test('meeting links accept Google Meet and Zoom and reject other destinations', () => {
  const meet = decideMeetingUrl('https://meet.google.com/abc-defg-hij');
  const zoom = decideMeetingUrl('https://us02web.zoom.us/j/123456789?pwd=abc');
  const http = decideMeetingUrl('http://meet.google.com/abc-defg-hij');
  const script = decideMeetingUrl('javascript:alert(1)');
  const other = decideMeetingUrl('https://example.com/j/123');
  assert.equal(meet.ok && meet.provider, 'google-meet');
  assert.equal(zoom.ok && zoom.provider, 'zoom');
  assert.equal(http.ok, false);
  assert.equal(script.ok, false);
  assert.equal(other.ok, false);
});

test('only the assigned people can read a confirmed meeting link', () => {
  const booking = {
    _id: BOOKING,
    studentId: LEARNER,
    expertId: EXPERT,
    lifecycle: 'CONFIRMED',
    startsAt: '2026-11-02T10:00:00.000Z',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
  };
  const now = new Date('2026-11-02T09:00:00.000Z');
  assert.equal(canReadMeetingLink(learner, booking, now), true);
  assert.equal(canReadMeetingLink(expert, booking, now), true);
  assert.equal(canReadMeetingLink(admin, booking, now), true);
  assert.equal(canReadMeetingLink(outsider, booking, now), false);
  assert.equal(canReadMeetingLink(learner, { ...booking, lifecycle: 'PENDING_CONFIRMATION' }, now), false);
  assert.equal(canReadMeetingLink({ userId: OTHER, role: 'instructor' }, booking, now), false);
});

test('lifecycle changes are limited by role and state', () => {
  const pending = {
    _id: BOOKING,
    studentId: LEARNER,
    expertId: EXPERT,
    lifecycle: 'PENDING_CONFIRMATION',
    startsAt: '2026-11-02T10:00:00.000Z',
    endsAt: '2026-11-02T10:30:00.000Z',
  };
  const now = new Date('2026-11-01T00:00:00.000Z');
  assert.equal(decideBookingAction({ member: expert, booking: pending, action: 'accept', now }).ok, true);
  assert.equal(decideBookingAction({ member: learner, booking: pending, action: 'accept', now }).ok, false);
  assert.equal(decideBookingAction({ member: learner, booking: pending, action: 'complete', now }).ok, false);
  const confirmed = { ...pending, lifecycle: 'CONFIRMED' };
  assert.equal(decideBookingAction({ member: learner, booking: confirmed, action: 'complete', now }).ok, false);
  assert.equal(decideBookingAction({ member: expert, booking: confirmed, action: 'complete', now }).ok, false);
  const started = decideBookingAction({
    member: expert,
    booking: confirmed,
    action: 'no-show',
    now: new Date('2026-11-02T10:05:00.000Z'),
  });
  assert.equal(started.ok && started.lifecycle, 'NO_SHOW');
  const closeCancel = decideBookingAction({
    member: learner,
    booking: confirmed,
    action: 'cancel',
    now: new Date('2026-11-02T09:30:00.000Z'),
  });
  assert.equal(closeCancel.ok, false);
  assert.equal(normalizeLifecycle({ status: 'accepted' }), 'CONFIRMED');
  assert.equal(paymentRequired(), false);
});

test('only an approved expert or a publishing super admin can set hours', () => {
  const superadmin = canPublishAvailability({ role: 'superadmin' }, { isExpert: false }, 'publish');
  const pause = canPublishAvailability({ role: 'superadmin' }, null, 'pause');
  const instructor = canPublishAvailability({ role: 'instructor' }, { isExpert: false }, 'publish');
  const approved = canPublishAvailability({ role: 'instructor' }, { isExpert: true }, 'publish');
  const student = canPublishAvailability({ role: 'student' }, { isExpert: true }, 'publish');
  assert.equal(superadmin.ok && superadmin.markExpert, true);
  assert.equal(pause.ok, false);
  assert.equal(instructor.ok, false);
  assert.equal(approved.ok && approved.markExpert, false);
  assert.equal(student.ok, false);
  const store = fs.readFileSync(path.join(__dirname, '../lib/consultation-booking-store.ts'), 'utf8');
  const adminPage = fs.readFileSync(path.join(__dirname, '../pages/consultations/admin.tsx'), 'utf8');
  assert.equal(store.includes('canPublishAvailability'), true);
  assert.equal(adminPage.includes('/consultations/admin'), true);
  assert.equal(adminPage.includes('/consultations/expert'), true);
});

test('consultation payment is not wired into course unlock', () => {
  const webhook = fs.readFileSync(path.join(__dirname, '../pages/api/paystack/webhook.ts'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/consultation-booking-store.ts'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../scripts/consultation-booking-indexes.js'), 'utf8');
  assert.equal(webhook.includes('unlockCourseFromWebhookPayload'), true);
  assert.equal(webhook.includes('consultationRequests'), false);
  assert.equal(store.includes('unlockCourse'), false);
  assert.equal(store.includes('PAYSTACK'), false);
  assert.equal(store.includes('createIndex'), false);
  assert.equal(script.includes('MongoClient'), false);
});

test('new consultation routes stay behind the consultation flag', () => {
  const disabled = { ...FEATURES, EXPERT_CONSULTATION: false };
  assert.equal(isFeatureApiBlocked('/api/consultations/experts/abc/slots', disabled), true);
  assert.equal(isFeatureApiBlocked('/api/consultations/reminders', disabled), true);
  assert.equal(isFeatureApiBlocked('/api/consultations/admin', disabled), false);
});

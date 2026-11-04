'use strict';

/**
 * Simulated market calendar (Phase 10). Pure. Version CALENDAR_VERSION.
 *
 * The week runs from 17:00 New York on Sunday to 17:00 New York on Friday. The rule is defined in New
 * York local time, so it moves with US daylight saving: in UTC the week opens at 21:00 in summer and
 * 22:00 in winter. Nothing here hard-codes UTC hours.
 *
 * A "trading day" starts at 17:00 New York and is named after the next calendar day, so Sunday 17:00
 * starts Monday's trading day. Adding 7 hours to the New York wall clock gives it directly.
 *
 * Coverage, deliberately limited and disclosed (docs/audits/phase-10-practice-trading.md):
 *   Closed all day:           New Year's Day, Good Friday, Christmas Day.
 *   Closes at 13:00 New York: Christmas Eve, New Year's Eve.
 * This is the simulator's own calendar. It does not follow any exchange or bank holiday list, and
 * regional holidays that thin real liquidity are not modelled.
 */

const CALENDAR_VERSION = 'fx-calendar-2';

const zoneFormat = (timeZone) => new Intl.DateTimeFormat('en-US', {
  timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const NEW_YORK = zoneFormat('America/New_York');

/** Sessions by local opening hours, so each follows its own daylight saving. */
const SESSIONS = Object.freeze([
  Object.freeze({ id: 'sydney', label: 'Sydney', opens: 7, closes: 16, format: zoneFormat('Australia/Sydney') }),
  Object.freeze({ id: 'tokyo', label: 'Tokyo', opens: 9, closes: 18, format: zoneFormat('Asia/Tokyo') }),
  Object.freeze({ id: 'london', label: 'London', opens: 8, closes: 17, format: zoneFormat('Europe/London') }),
  Object.freeze({ id: 'new_york', label: 'New York', opens: 8, closes: 17, format: NEW_YORK }),
]);

const HOLIDAYS = Object.freeze([
  Object.freeze({ month: 1, day: 1, name: "New Year's Day" }),
  Object.freeze({ month: 12, day: 25, name: 'Christmas Day' }),
]);

const EARLY_CLOSES = Object.freeze([
  Object.freeze({ month: 12, day: 24, name: 'Christmas Eve', hour: 13 }),
  Object.freeze({ month: 12, day: 31, name: "New Year's Eve", hour: 13 }),
]);

function fieldsIn(format, time) {
  const parts = {};
  for (const { type, value } of format.formatToParts(time)) parts[type] = Number(value);
  return parts;
}

/** Easter Sunday in the Gregorian calendar (the anonymous algorithm): { month, day }. */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function goodFriday(year) {
  const { month, day } = easterSunday(year);
  const friday = new Date(Date.UTC(year, month - 1, day - 2));
  return { month: friday.getUTCMonth() + 1, day: friday.getUTCDate(), name: 'Good Friday' };
}

/** The trading day of an instant: { year, month, day, weekday } (weekday 0 = Sunday). */
function tradingDay(time) {
  const f = fieldsIn(NEW_YORK, time);
  // The wall clock, shifted 7 hours. Date.UTC here is only calendar arithmetic, not a time zone.
  const shifted = new Date(Date.UTC(f.year, f.month - 1, f.day, f.hour + 7, f.minute, f.second));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** Whether the market is open at an instant, and why not. */
function marketSession(time) {
  if (!(time instanceof Date) || Number.isNaN(time.getTime())) return { open: false, reason: 'invalid_time' };
  const day = tradingDay(time);
  if (day.weekday === 0 || day.weekday === 6) return { open: false, reason: 'weekend' };
  const holiday = [...HOLIDAYS, goodFriday(day.year)].find((h) => h.month === day.month && h.day === day.day);
  if (holiday) return { open: false, reason: 'holiday', holiday: holiday.name };
  const early = EARLY_CLOSES.find((h) => h.month === day.month && h.day === day.day);
  if (early) {
    const { hour } = fieldsIn(NEW_YORK, time);
    if (hour >= early.hour && hour < 17) return { open: false, reason: 'early_close', holiday: early.name };
  }
  return { open: true, reason: null };
}

/** The named sessions active at an instant. Empty when the market is closed. */
function activeSessions(time) {
  if (!marketSession(time).open) return [];
  return SESSIONS.filter((session) => {
    const { hour } = fieldsIn(session.format, time);
    return hour >= session.opens && hour < session.closes;
  }).map((session) => session.label);
}

/** The next instant the market opens, searching hour by hour: every boundary falls on the hour. */
function nextOpen(time, { maxHours = 24 * 8 } = {}) {
  const hourMs = 3600000;
  let at = Math.floor(time.getTime() / hourMs) * hourMs + hourMs;
  for (let i = 0; i < maxHours; i += 1, at += hourMs) {
    if (marketSession(new Date(at)).open) return new Date(at);
  }
  return null;
}

module.exports = { CALENDAR_VERSION, EARLY_CLOSES, HOLIDAYS, SESSIONS, activeSessions, easterSunday, goodFriday, marketSession, nextOpen, tradingDay };

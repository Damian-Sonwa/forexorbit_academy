'use strict';

/**
 * Forex market calendar (Phase 10, G2). Pure.
 *
 * The spot market trades continuously from 17:00 New York on Sunday to 17:00 New York on Friday.
 * The rule is defined in New York local time, so it moves with US daylight saving automatically:
 * in UTC the week opens at 21:00 in summer and 22:00 in winter. Nothing here hard-codes UTC hours.
 *
 * A "trading day" starts at 17:00 New York and is named after the next calendar day. So Sunday
 * 17:00 starts Monday's trading day and Friday 17:00 ends Friday's. Adding 7 hours to the New York
 * wall clock gives the trading day directly. Saturday and Sunday trading days do not exist.
 *
 * Holidays: New Year's Day and Christmas Day are closed, as those trading days have no meaningful
 * interbank market. Other holidays thin liquidity without closing the market, so the calendar does
 * not close for them; missing data on such days still suspends trading. This is the simplified
 * model disclosed to students.
 */

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const HOLIDAYS = Object.freeze([
  Object.freeze({ month: 1, day: 1, name: "New Year's Day" }),
  Object.freeze({ month: 12, day: 25, name: 'Christmas Day' }),
]);

function newYorkFields(time) {
  const fields = {};
  for (const part of NEW_YORK.formatToParts(time)) fields[part.type] = Number(part.value);
  return fields;
}

/** The trading day of an instant: { year, month, day, weekday } (weekday 0 = Sunday). */
function tradingDay(time) {
  const f = newYorkFields(time);
  // The wall clock, shifted 7 hours. Date.UTC here is only calendar arithmetic, not a time zone.
  const shifted = new Date(Date.UTC(f.year, f.month - 1, f.day, f.hour + 7, f.minute, f.second));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** Whether the market is open at an instant, and why not. */
function marketSession(time) {
  if (!(time instanceof Date) || Number.isNaN(time.getTime())) return { open: false, reason: 'invalid_time' };
  const day = tradingDay(time);
  if (day.weekday === 0 || day.weekday === 6) return { open: false, reason: 'weekend' };
  const holiday = HOLIDAYS.find((h) => h.month === day.month && h.day === day.day);
  if (holiday) return { open: false, reason: 'holiday', holiday: holiday.name };
  return { open: true, reason: null };
}

module.exports = { HOLIDAYS, marketSession, tradingDay };

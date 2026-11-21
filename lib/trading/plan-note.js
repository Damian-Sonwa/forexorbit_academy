'use strict';

/**
 * The order-ticket note ("why am I taking this trade?"). Optional free text kept with the order and
 * shown when the trade is reviewed. It plays no part in an order's identity, risk checks or fills.
 */

const NOTE_MAX = 500;

/** Trimmed, control characters removed, length-limited. Empty or missing -> ''. null when invalid. */
function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return text.length > max ? null : text;
}

/** Returns { ok: true, note } (note may be '') or { ok: false, error }. */
function readPlanNote(value) {
  const note = cleanText(value, NOTE_MAX);
  if (note === null) return { ok: false, error: `The trade plan note can be at most ${NOTE_MAX} characters.` };
  return { ok: true, note };
}

module.exports = { NOTE_MAX, cleanText, readPlanNote };

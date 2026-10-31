'use strict';

/**
 * URL policy for course and lesson links that the app stores and later renders as `href` or
 * `src` (lesson resources, video and PDF links, course thumbnails).
 *
 * Allowed: absolute http(s) URLs with a host, and relative URLs ("/courses/x", "notes.pdf",
 * "#part-2"). Refused: every other scheme (javascript:, data:, vbscript:, file:, blob:, ...),
 * any URL containing whitespace or control characters (browsers drop those inside a scheme, so
 * "java\tscript:" would run), and anything longer than MAX_URL_LENGTH.
 *
 * Used before saving (API validation) and again before rendering, so a value stored before this
 * policy existed is never rendered as a live link.
 */

const MAX_URL_LENGTH = 2048;
const ALLOWED_SCHEMES = Object.freeze(['http', 'https']);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/;

/**
 * The URL to store or render, or null when it is not allowed. Surrounding whitespace is trimmed.
 * `allowRelative: false` requires an absolute http(s) URL.
 */
function safeLinkUrl(value, { allowRelative = true } = {}) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > MAX_URL_LENGTH) return null;
  if (WHITESPACE_OR_CONTROL.test(url)) return null;
  const scheme = SCHEME.exec(url);
  if (scheme) {
    if (!ALLOWED_SCHEMES.includes(scheme[1].toLowerCase())) return null;
    try {
      const parsed = new URL(url);
      if (!parsed.hostname) return null;
    } catch {
      return null;
    }
    return url;
  }
  // No scheme. Refuse a colon before the first "/", "?" or "#" rather than guess how a parser
  // would read it.
  const head = url.split(/[/?#]/, 1)[0];
  if (head.includes(':')) return null;
  // Relative, including protocol-relative "//host/x", which takes the page's own http(s) scheme.
  return allowRelative ? url : null;
}

function isSafeLinkUrl(value, options) {
  return safeLinkUrl(value, options) !== null;
}

module.exports = { ALLOWED_SCHEMES, MAX_URL_LENGTH, isSafeLinkUrl, safeLinkUrl };

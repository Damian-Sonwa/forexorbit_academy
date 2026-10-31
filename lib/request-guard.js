'use strict';

/**
 * Origin, CSRF and CORS rules for cookie sessions (Phase 4.5). Pure functions with no Node-only
 * dependencies, so the Edge middleware, API routes and the Socket.IO server share them.
 *
 * One canonical HTTPS origin serves pages, API and sockets (owner decision): APP_ORIGIN, for
 * example https://app.example.com. Outside production the local dev server's own origins
 * (http://localhost:PORT and http://127.0.0.1:PORT) are also trusted. Nothing else is: there are
 * no platform wildcards such as *.vercel.app.
 *
 * State-changing API requests (anything but GET, HEAD, OPTIONS) must
 *   1. come from a trusted origin (Origin header, else the Referer's origin); and
 *   2. carry the custom header `X-FO-CSRF: 1`. A cross-site form cannot send a custom header, and
 *      a cross-site script cannot send one without a CORS preflight that is refused.
 * Server-to-server endpoints with their own signature check (the Paystack webhook) are exempt.
 */

const CSRF_HEADER = 'x-fo-csrf';
const CSRF_VALUE = '1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = Object.freeze(['/api/paystack/webhook']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** "scheme://host[:port]" for an absolute http(s) URL without path, query or credentials; else null. */
function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname && url.pathname !== '/') return null;
  return url.origin;
}

/**
 * The configured canonical origin. In production it must be an https origin; elsewhere http is
 * accepted for localhost only. Returns { ok, origin } or { ok: false, error } (never throws).
 */
function appOriginConfig(env = process.env) {
  const raw = String(env.APP_ORIGIN || '').trim();
  const production = env.NODE_ENV === 'production';
  if (!raw) {
    return production ? { ok: false, error: 'APP_ORIGIN is not set.' } : { ok: true, origin: null };
  }
  const origin = normalizeOrigin(raw);
  if (!origin) return { ok: false, error: 'APP_ORIGIN must be an origin such as https://app.example.com (no path).' };
  const { protocol, hostname } = new URL(origin);
  if (protocol !== 'https:' && (production || !LOCAL_HOSTS.has(hostname))) {
    return { ok: false, error: 'APP_ORIGIN must use https.' };
  }
  return { ok: true, origin };
}

/** Every origin trusted for credentialed requests in this environment. Empty when misconfigured. */
function trustedOrigins(env = process.env) {
  const config = appOriginConfig(env);
  const list = [];
  if (config.ok && config.origin) list.push(config.origin);
  if (env.NODE_ENV !== 'production') {
    const port = String(env.PORT || '3000').trim();
    for (const host of LOCAL_HOSTS) {
      const local = `http://${host}:${port}`;
      if (!list.includes(local)) list.push(local);
    }
  }
  return list;
}

function isTrustedOrigin(origin, env = process.env) {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized) && trustedOrigins(env).includes(normalized);
}

/** The request's origin: the Origin header, else the Referer's origin, else null. */
function requestOrigin(header) {
  const origin = header('origin');
  if (typeof origin === 'string' && origin && origin !== 'null') return normalizeOrigin(origin);
  const referer = header('referer');
  if (typeof referer === 'string' && referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * CSRF and Origin decision for one API request. `header(name)` returns a lower-case header's
 * value. Returns { ok: true } or { ok: false, status: 403, error, code }.
 */
function decideRequestOrigin({ method, pathname, header, env = process.env }) {
  const verb = String(method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(verb)) return { ok: true };
  if (EXEMPT_PATHS.includes(String(pathname || '').replace(/\/+$/, ''))) return { ok: true };
  const refuse = (code) => ({ ok: false, status: 403, error: 'Request refused.', code });
  const trusted = trustedOrigins(env);
  if (!trusted.length) return refuse('origin_not_configured');
  const origin = requestOrigin(header);
  if (!origin) return refuse('origin_missing');
  if (!trusted.includes(origin)) return refuse('origin_not_allowed');
  if (header(CSRF_HEADER) !== CSRF_VALUE) return refuse('csrf_header_missing');
  return { ok: true };
}

/**
 * Socket.IO handshake origin. Browsers send Origin on WebSocket and cross-origin requests; on a
 * same-origin polling GET they may omit it but send `Sec-Fetch-Site: same-origin`. Anything else
 * (no Origin and no same-origin fetch metadata, or a foreign Origin) is refused.
 */
function decideSocketOrigin({ header, env = process.env }) {
  const origin = header('origin');
  if (typeof origin === 'string' && origin && origin !== 'null') {
    return isTrustedOrigin(origin, env) ? { ok: true } : { ok: false, code: 'origin_not_allowed' };
  }
  if (header('sec-fetch-site') === 'same-origin' && trustedOrigins(env).length) return { ok: true };
  return { ok: false, code: 'origin_missing' };
}

/** The value for Access-Control-Allow-Origin: an exactly trusted origin, else null. */
function corsOrigin(origin, env = process.env) {
  const normalized = normalizeOrigin(origin || '');
  return normalized && trustedOrigins(env).includes(normalized) ? normalized : null;
}

module.exports = {
  CSRF_HEADER,
  CSRF_VALUE,
  EXEMPT_PATHS,
  appOriginConfig,
  corsOrigin,
  decideRequestOrigin,
  decideSocketOrigin,
  isTrustedOrigin,
  normalizeOrigin,
  requestOrigin,
  trustedOrigins,
};

/**
 * Browser origins for this environment.
 *
 * NEXT_PUBLIC_SOCKET_URL
 *   Absolute origin of the Socket.IO server. When unset, the client uses the
 *   page origin. Split hosting must set this to the same backend that issued
 *   the JWT. Development and preview must leave it unset or point it at that
 *   environment's own server.
 *
 * NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_API_URL
 *   Absolute origin for HTTP calls when the page is not served by the API.
 *   When unset, callers use a same-origin path. Do not point a development or
 *   preview build at the production host.
 */

function trimOrigin(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

function resolveSocketUrl(configured, pageOrigin) {
  const explicit = trimOrigin(configured);
  if (explicit) return explicit;
  return trimOrigin(pageOrigin);
}

function resolveApiBaseUrl(configured) {
  return trimOrigin(configured);
}

module.exports = {
  resolveSocketUrl,
  resolveApiBaseUrl,
};

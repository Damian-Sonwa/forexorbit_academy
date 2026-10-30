'use strict';

/**
 * Client address for rate limiting.
 *
 * A client can put anything in X-Forwarded-For; only the entries appended by proxies we run
 * behind can be trusted. Each trusted proxy appends the address it received the request from,
 * so the client address is the entry `trustedHops` places from the right. The left-hand entries
 * (written by the client) are never used.
 *
 * TRUSTED_PROXY_HOPS sets how many proxies append to the header in front of this server
 * (default 1, a single platform proxy such as Render's). 0 ignores the header and uses the socket
 * address, for a server reached directly. The deployment's real hop count has not been verified
 * from this repository; see docs/audits/auth-rate-limiting-h1.md.
 *
 * IPv6 addresses are reduced to their /64 network, since one subscriber usually holds a whole
 * /64. Returns null when no valid address is available; callers must then skip IP-based limits
 * rather than group every such request under one shared key.
 */

const net = require('net');

const DEFAULT_TRUSTED_HOPS = 1;
const MAX_TRUSTED_HOPS = 5;
const MAX_HEADER_ENTRIES = 50;

function trustedHops(env = process.env) {
  const raw = String(env.TRUSTED_PROXY_HOPS ?? '').trim();
  if (raw === '') return DEFAULT_TRUSTED_HOPS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_TRUSTED_HOPS ? n : DEFAULT_TRUSTED_HOPS;
}

/** A bare, valid IP for a header or socket value, or null. Strips ports, brackets and IPv4-mapped prefixes. */
function cleanAddress(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  if (!v || v.length > 64) return null;
  const bracketed = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) v = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(':'));
  v = v.replace(/%.*$/, '');
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(v)) v = v.slice(7);
  return net.isIP(v) ? v.toLowerCase() : null;
}

/** IPv4 as is; IPv6 as its /64 network prefix. */
function rateLimitAddress(ip) {
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return null;
  // Expand "::" so the first four groups can be read.
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

function headerValue(headers, name) {
  const raw = headers ? headers[name] : undefined;
  return Array.isArray(raw) ? raw.join(',') : raw;
}

/** The address requests from this client should be counted under, or null if it cannot be told. */
function clientAddress(req, env = process.env) {
  const hops = trustedHops(env);
  let ip = null;
  if (hops > 0) {
    const header = headerValue(req && req.headers, 'x-forwarded-for');
    if (typeof header === 'string' && header) {
      const entries = header.split(',').slice(-MAX_HEADER_ENTRIES);
      // Fewer entries than trusted hops: the header did not come through the expected proxies.
      if (entries.length >= hops) ip = cleanAddress(entries[entries.length - hops]);
    }
  }
  if (!ip) {
    const socket = req && (req.socket || req.connection);
    ip = cleanAddress(socket && socket.remoteAddress);
  }
  return ip ? rateLimitAddress(ip) : null;
}

module.exports = { DEFAULT_TRUSTED_HOPS, cleanAddress, clientAddress, rateLimitAddress, trustedHops };

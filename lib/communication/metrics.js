'use strict';

/**
 * In-process communication counters (Phase 14): socket connections, refusals, disconnections,
 * real-time emits, worker runs and failures. Shared through globalThis because server.js and the
 * Next.js API bundles load separate module copies (the same reason as lib/socket-server.js).
 * Counts only: no user ids, addresses or contents. They reset when the process restarts; durable
 * delivery figures come from the database (lib/communication/delivery.js deliveryStats).
 */

const KEY = '__forexorbitCommunicationMetrics';
const SOCKET_KEY = '__forexorbitSocketServer';

function state() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = { startedAt: new Date().toISOString(), counters: {}, gauges: { activeSockets: 0 }, lastWorker: null };
  }
  return globalThis[KEY];
}

const count = (name, by = 1) => { const s = state(); s.counters[name] = (s.counters[name] || 0) + by; };
const gauge = (name, delta) => { const s = state(); s.gauges[name] = Math.max(0, (s.gauges[name] || 0) + delta); };
const worker = (summary) => { state().lastWorker = { at: new Date().toISOString(), ...summary }; };
const snapshot = () => JSON.parse(JSON.stringify(state()));
const socketServer = () => globalThis[SOCKET_KEY] || null;

module.exports = { count, gauge, snapshot, socketServer, worker };

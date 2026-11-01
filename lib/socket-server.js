/**
 * Socket.io Server Instance
 * Provides access to Socket.io instance from API routes
 *
 * Phase 8: the instance is kept on globalThis. server.js loads this file with Node's require,
 * while Next.js bundles API routes (and lib/auth-middleware.ts with them) separately, so each
 * side had its own copy of a module-level variable and API routes always saw null: `req.io` was
 * never set and no route could broadcast. Storing it on globalThis gives every copy, in the same
 * process, the same instance.
 */

const KEY = '__forexorbitSocketServer';

function setSocketServer(io) {
  globalThis[KEY] = io;
}

function getSocketServer() {
  return globalThis[KEY] || null;
}

module.exports = {
  setSocketServer,
  getSocketServer,
};

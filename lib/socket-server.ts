/**
 * Socket.io Server Instance
 * Provides access to Socket.io instance from API routes
 *
 * Phase 8: shared through globalThis with lib/socket-server.js (which server.js loads), because
 * Next.js bundles API routes separately and a module-level variable here was never the one
 * server.js set. See lib/socket-server.js.
 */

import type { Server } from 'socket.io';

const KEY = '__forexorbitSocketServer';
type SocketGlobal = typeof globalThis & { [KEY]?: Server };

export function setSocketServer(io: Server) {
  (globalThis as SocketGlobal)[KEY] = io;
}

export function getSocketServer(): Server | null {
  return (globalThis as SocketGlobal)[KEY] || null;
}

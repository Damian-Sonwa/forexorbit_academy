'use strict';

/**
 * Disconnects Socket.IO connections whose session has ended (Phase 4.5).
 *
 * Each socket keeps its account in `socket.data.user`, its session family in
 * `socket.data.sessionFamilyId`, and is in the room `user:<id>`. These helpers act on the sockets of
 * this process. Sockets served by another process are ended by their own periodic and per-event
 * session checks in server.js. Clients receive `session_ended` before the disconnect.
 *
 * Next compiles API routes into their own module instances, so server.js registers its Socket.IO
 * server here through a process-wide slot (registerSessionSocketServer) that both sides can read.
 */

const SLOT = Symbol.for('forexorbit.sessionSocketServer');

function registerSessionSocketServer(io) {
  globalThis[SLOT] = io;
}

function sessionSocketServer() {
  return globalThis[SLOT] || null;
}

function endSocketsForUser(io, userId) {
  io = io || sessionSocketServer();
  if (!io || typeof userId !== 'string' || !userId) return;
  try {
    io.to(`user:${userId}`).emit('session_ended');
    io.in(`user:${userId}`).disconnectSockets(true);
  } catch {
    console.error('[session] socket disconnect failed');
  }
}

function endSocketsForFamily(io, familyId) {
  io = io || sessionSocketServer();
  if (!io || typeof familyId !== 'string' || !familyId) return;
  try {
    for (const socket of io.of('/').sockets.values()) {
      if (socket.data && socket.data.sessionFamilyId === familyId) {
        socket.emit('session_ended');
        socket.disconnect(true);
      }
    }
  } catch {
    console.error('[session] socket disconnect failed');
  }
}

module.exports = { endSocketsForFamily, endSocketsForUser, registerSessionSocketServer, sessionSocketServer };

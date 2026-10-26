/**
 * Disabled duplicate Socket.IO setup.
 * The canonical server is created in server.js on path /api/socket.
 * Calling this function does not attach a server.
 */
export function initializeSocket(): never {
  throw new Error('Socket.IO is provided by the application server');
}

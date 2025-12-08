/**
 * Socket.io Server Instance
 * Provides access to Socket.io instance from API routes
 */

import { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setSocketServer(io: Server) {
  ioInstance = io;
}

export function getSocketServer(): Server | null {
  return ioInstance;
}






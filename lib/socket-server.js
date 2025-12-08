/**
 * Socket.io Server Instance
 * Provides access to Socket.io instance from API routes
 */

let ioInstance = null;

function setSocketServer(io) {
  ioInstance = io;
}

function getSocketServer() {
  return ioInstance;
}

module.exports = {
  setSocketServer,
  getSocketServer,
};









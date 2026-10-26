/**
 * Production entry for Windows and Linux.
 * server.js reads NODE_ENV while it loads, so this is set first.
 * Development stays on `npm run dev`.
 */
process.env.NODE_ENV = 'production';
require('../server.js');

/**
 * Socket.IO entry points. No network connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('the package scripts start the authenticated custom server', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const starter = fs.readFileSync(path.join(root, 'scripts', 'start-production.js'), 'utf8');
  assert.equal(packageJson.scripts.dev, 'node server.js');
  assert.equal(packageJson.scripts.start, 'node scripts/start-production.js');
  assert.equal(packageJson.scripts['start:prod'], 'node scripts/start-production.js');
  assert.equal(starter.includes("process.env.NODE_ENV = 'production'"), true);
  assert.equal(starter.indexOf("process.env.NODE_ENV = 'production'") < starter.indexOf("require('../server.js')"), true);
  assert.equal(JSON.stringify(packageJson.scripts).includes('server/socket'), false);
});

test('the custom server is the only Socket.IO constructor', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'pages', 'api', 'socket.ts'), 'utf8');
  const dormant = fs.readFileSync(path.join(root, 'server', 'socket.ts'), 'utf8');
  assert.equal(server.includes("path: '/api/socket'"), true);
  assert.equal(server.includes('decideAccountAccess'), true);
  assert.equal(server.includes('new Server(server'), true);
  assert.equal(server.includes('server/socket'), false);
  assert.equal(server.includes('initializeSocket'), false);
  assert.equal(route.includes('new SocketIOServer'), false);
  assert.equal(route.includes('new Server('), false);
  assert.equal(route.includes("res.status(404)"), true);
  assert.equal(dormant.includes('new SocketIOServer'), false);
  assert.equal(dormant.includes('throw new Error'), true);
});

test('community presence is not broadcast to every connected socket', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.equal(server.includes('decideCommunityPresence'), true);
  assert.equal(server.includes("socket.join('presence:community')"), false);
  assert.equal(server.includes("socket.broadcast.emit('userOnline'"), false);
  assert.equal(server.includes("socket.broadcast.emit('userOffline'"), false);
  const online = server.slice(server.indexOf("socket.on('userOnline'"), server.indexOf("socket.on('disconnecting'"));
  assert.equal(online.includes('user.email'), false);
  assert.equal(online.includes('userId: decision.userId'), true);
});

test('a plain request to the Next socket route does not construct a server', () => {
  const route = fs.readFileSync(path.join(root, 'pages', 'api', 'socket.ts'), 'utf8');
  assert.equal(route.includes('socket.io'), false);
  assert.equal(route.includes('Socket.IO is not created here'), true);
  assert.equal(route.includes('res.status(404)'), true);
});

/**
 * Guards for the measured hot paths.
 * These checks do not time a live server and do not open MongoDB.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('the course list loads one progress query instead of one query per course', () => {
  const source = read('pages/api/courses/index.ts');
  assert.equal(source.includes('progress.findOne'), false);
  assert.equal(source.includes('progress.find('), true);
  assert.equal(source.includes('progressByCourse'), true);
});

test('a lesson list reuses the lessons it already loaded', () => {
  const source = read('pages/api/lessons/index.ts');
  assert.equal(source.includes('outline === \'1\''), true);
  assert.equal(source.includes('lessonsList as Record<string, unknown>[]'), true);
  const course = read('pages/api/courses/[id].ts');
  assert.equal(course.includes('courseLessons as Record<string, unknown>[]'), true);
  const locks = read('lib/course-lessons-locked.ts');
  assert.equal(locks.includes('preloaded'), true);
  const paid = read('lib/lesson-monetization.ts');
  assert.equal(paid.includes('return hasCourseEntitlement(db, userId, courseId);'), true);
});

test('room seeding does not block the server from listening', () => {
  const source = read('server.js');
  assert.equal(source.includes('await seedRooms()'), false);
  assert.equal(source.includes('seedRooms()'), true);
  assert.equal(source.includes("io.to('market-signals').emit('marketSignal', signal)"), true);
  assert.equal(source.includes("io.emit('marketSignal', signal)"), false);
});

test('the browser keeps one socket connection for the signed-in session', () => {
  const socket = read('hooks/useSocket.ts');
  const app = read('pages/_app.tsx');
  assert.equal(socket.includes('export function SocketProvider'), true);
  assert.equal(socket.includes('auth: { token }'), false, 'the session cookie authenticates the socket');
  assert.equal(socket.includes('withCredentials: true'), true);
  assert.equal(app.includes('<SocketProvider>'), true);
});

test('landing and catalog images are served as WebP under a size budget', () => {
  const page = read('pages/index.tsx');
  assert.equal(page.includes('/images/smd.webp'), true);
  assert.equal(page.includes('.jpg'), false);
  assert.match(page, /fetchPriority="high"|fetchpriority: 'high'/);
  assert.equal(page.includes('loading="lazy"'), true);
  const budgets = {
    'smd.webp': 200000,
    'financial-learning-dashboard-devices.webp': 250000,
  };
  for (const [name, budget] of Object.entries(budgets)) {
    const size = fs.statSync(path.join(root, 'public', 'images', name)).size;
    assert.ok(size < budget, `${name} is ${size} bytes`);
  }
  const catalog = path.join(root, 'public', 'images', 'catalog');
  const files = fs.readdirSync(catalog);
  assert.equal(files.some((name) => name.endsWith('.jpg') || name.endsWith('.png')), false);
  for (const name of files.filter((file) => file.endsWith('.webp'))) {
    const size = fs.statSync(path.join(catalog, name)).size;
    assert.ok(size < 250000, `${name} is ${size} bytes`);
  }
});

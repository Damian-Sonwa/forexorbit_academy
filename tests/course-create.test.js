/**
 * Course creation ownership. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decideCourseCreate } = require('../lib/account-access');

const INSTRUCTOR = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';

function body(overrides = {}) {
  return {
    title: 'Price Action',
    description: 'How candles form.',
    category: 'technical',
    difficulty: 'beginner',
    thumbnail: 'https://cdn.example/thumb.jpg',
    ...overrides,
  };
}

test('an instructor owns the course and cannot assign another instructor', () => {
  const own = decideCourseCreate({
    member: { userId: INSTRUCTOR, role: 'instructor' },
    body: body({ instructorId: INSTRUCTOR }),
  });
  const forged = decideCourseCreate({
    member: { userId: INSTRUCTOR, role: 'instructor' },
    body: body({ instructorId: OTHER, role: 'admin', password: 'secret' }),
  });
  const omitted = decideCourseCreate({
    member: { userId: INSTRUCTOR, role: 'instructor' },
    body: body(),
  });
  assert.equal(own.ok, true);
  assert.equal(omitted.ok, true);
  assert.equal(forged.ok, false);
  if (own.ok) {
    assert.equal(own.document.instructorId, INSTRUCTOR);
    assert.equal(Object.prototype.hasOwnProperty.call(own.document, 'role'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(own.document, 'password'), false);
  }
  if (!forged.ok) assert.equal(forged.status, 403);
});

test('admins and superadmins can assign an active instructor', () => {
  for (const role of ['admin', 'superadmin']) {
    const decision = decideCourseCreate({
      member: { userId: 'staff-1', role },
      body: body({ instructorId: OTHER }),
      assignee: { userId: OTHER, role: 'instructor', status: 'approved' },
    });
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.document.instructorId, OTHER);
  }
});

test('a forged, inactive, or non-instructor assignee is rejected', () => {
  const missing = decideCourseCreate({
    member: { userId: 'admin-1', role: 'admin' },
    body: body({ instructorId: OTHER }),
    assignee: null,
  });
  const student = decideCourseCreate({
    member: { userId: 'admin-1', role: 'admin' },
    body: body({ instructorId: OTHER }),
    assignee: { userId: OTHER, role: 'student', status: 'approved' },
  });
  const inactive = decideCourseCreate({
    member: { userId: 'admin-1', role: 'superadmin' },
    body: body({ instructorId: OTHER }),
    assignee: { userId: OTHER, role: 'instructor', status: 'suspended' },
  });
  const invalid = decideCourseCreate({
    member: { userId: INSTRUCTOR, role: 'instructor' },
    body: body({ title: ' ', difficulty: 'expert' }),
  });
  const failed = decideCourseCreate({
    member: { userId: 'admin-1', role: 'admin' },
    body: body({ instructorId: OTHER }),
    lookupError: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(student.ok, false);
  assert.equal(inactive.ok, false);
  assert.equal(invalid.ok, false);
  assert.equal(failed.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 400);
  if (!failed.ok) assert.equal(failed.status, 500);
});

test('the create route does not echo the request body', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'courses', 'index.ts'), 'utf8');
  const start = source.indexOf('async function createCourse');
  const end = source.indexOf('async function getHandler');
  const create = source.slice(start, end);
  assert.equal(create.includes('decideCourseCreate'), true);
  assert.equal(create.includes('...req.body'), false);
  assert.equal(create.includes('...decision.document'), true);
  assert.equal(source.includes("['admin', 'instructor', 'superadmin']"), true);
});

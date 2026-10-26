/**
 * Course response allowlists. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { presentCourse, canReadCourseLessons, COURSE_RESPONSE_FIELDS } = require('../lib/course-response');

test('a catalog course keeps the public fields and drops stored extras', () => {
  const view = presentCourse({
    _id: '507f1f77bcf86cd799439011',
    title: 'Price action',
    description: '<p>Catalog copy</p>',
    category: 'technical',
    difficulty: 'beginner',
    thumbnail: 'https://res.cloudinary.com/demo/image/upload/course.png',
    instructorId: '507f1f77bcf86cd799439013',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    internalNote: 'hidden',
    lessons: [{ videoUrl: 'https://videos.example/private' }],
  });

  assert.equal(view.id, '507f1f77bcf86cd799439011');
  assert.equal(view._id, view.id);
  assert.equal(view.title, 'Price action');
  assert.equal(view.instructorId, '507f1f77bcf86cd799439013');
  for (const key of COURSE_RESPONSE_FIELDS) {
    assert.equal(typeof view[key], 'string');
  }
  for (const key of ['createdAt', 'updatedAt', 'internalNote', 'lessons', 'progress', 'enrolled']) {
    assert.equal(Object.prototype.hasOwnProperty.call(view, key), false, key);
  }
  assert.equal(JSON.stringify(view).includes('videos.example'), false);
});

test('an authenticated course view can attach progress and filtered lessons', () => {
  const lessons = [{ _id: 'lesson-1', title: 'Candles', locked: true }];
  const view = presentCourse(
    { _id: 'course-1', title: 'Price action', lessons: [{ videoUrl: 'https://videos.example/private' }] },
    { progress: 40, enrolled: true, lessons }
  );
  assert.equal(view.progress, 40);
  assert.equal(view.enrolled, true);
  assert.equal(view.lessons, lessons);
  assert.equal(JSON.stringify(view).includes('videos.example'), false);
});

test('an assigned instructor id is kept and an unassigned instructor cannot read lessons', () => {
  const owner = '507f1f77bcf86cd799439012';
  const view = presentCourse({
    _id: '507f1f77bcf86cd799439011',
    title: 'Price action',
    instructorId: { toString() { return owner; } },
  });
  assert.equal(view.instructorId, owner);
  assert.equal(canReadCourseLessons('instructor', owner, view.instructorId), true);
  assert.equal(canReadCourseLessons('instructor', '507f1f77bcf86cd799439099', view.instructorId), false);
  assert.equal(canReadCourseLessons('admin', '507f1f77bcf86cd799439099', view.instructorId), true);
});

test('course list and detail routes present an allowlisted document', () => {
  const list = fs.readFileSync(path.join(__dirname, '..', 'pages/api/courses/index.ts'), 'utf8');
  const detail = fs.readFileSync(path.join(__dirname, '..', 'pages/api/courses/[id].ts'), 'utf8');
  assert.equal(list.includes('presentCourse('), true);
  assert.equal(detail.includes('presentCourse('), true);
  assert.equal(list.includes('...stripCourseVisualAidsFields'), false);
  assert.equal(detail.includes('...stripCourseVisualAidsFields'), false);
});

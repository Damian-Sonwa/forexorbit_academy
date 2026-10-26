/**
 * Public lesson outlines. No database connection.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { presentLessonRead } = require('../lib/account-access');

const COURSE_ID = '507f1f77bcf86cd799439011';

function lesson(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439012',
    courseId: 'client-course',
    title: 'Candles',
    description: 'A short public blurb.',
    summary: 'This seeded summary is the full lesson essay and should stay off the outline. https://videos.example/private',
    type: 'video',
    order: 1,
    content: '<p>Full lesson body</p>',
    videoUrl: 'https://videos.example/private',
    pdfUrl: 'https://files.example/notes.pdf',
    resources: [{ url: 'https://files.example/notes.pdf' }],
    lessonSummary: { overview: 'This seeded summary is the full lesson essay and should stay off the outline.' },
    ...overrides,
  };
}

test('a public outline keeps the short description and drops protected lesson material', () => {
  const view = presentLessonRead(lesson(), false, COURSE_ID);
  assert.equal(view.title, 'Candles');
  assert.equal(view.description, 'A short public blurb.');
  assert.equal(view.courseId, COURSE_ID);
  assert.equal(view.locked, true);
  for (const key of ['summary', 'content', 'videoUrl', 'pdfUrl', 'resources', 'lessonSummary']) {
    assert.equal(Object.prototype.hasOwnProperty.call(view, key), false);
  }
  assert.equal(JSON.stringify(view).includes('videos.example'), false);
});

test('a long description or a copied lesson body is not published as metadata', () => {
  const longText = 'A'.repeat(400);
  const longView = presentLessonRead(lesson({ description: longText }), false, COURSE_ID);
  const copied = presentLessonRead(
    lesson({ description: '<p>Full lesson body</p>', content: '<p>Full lesson body</p>' }),
    false,
    COURSE_ID
  );
  const linked = presentLessonRead(
    lesson({ description: 'Watch https://videos.example/private before class' }),
    false,
    COURSE_ID
  );
  assert.equal(Object.prototype.hasOwnProperty.call(longView, 'description'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(copied, 'description'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(linked, 'description'), false);
  assert.equal(longView.title, 'Candles');
});

test('an authorized read still receives the stored description, summary, and media', () => {
  const view = presentLessonRead(lesson(), true, COURSE_ID);
  assert.equal(view.description, 'A short public blurb.');
  assert.equal(view.summary.includes('full lesson essay'), true);
  assert.equal(view.content, '<p>Full lesson body</p>');
  assert.equal(view.videoUrl, 'https://videos.example/private');
  assert.equal(view.accessible, true);
});

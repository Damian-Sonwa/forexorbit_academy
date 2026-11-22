/**
 * Course API responses. Only these fields are copied from a stored course.
 * Lessons, progress, and enrollment are attached by the route after its own checks.
 */

const { courseStatus } = require('./course-lifecycle');

const COURSE_RESPONSE_FIELDS = [
  'title',
  'description',
  'category',
  'difficulty',
  'thumbnail',
];

/** Optional course builder details, copied when present. */
const OPTIONAL_TEXT_FIELDS = ['summary', 'prerequisites'];

function storedIdString(value) {
  const text = value == null ? '' : String(value).trim();
  return /^[a-f0-9]{24}$/i.test(text) ? text : '';
}

function canReadCourseLessons(role, userId, instructorId) {
  if (role === 'admin' || role === 'superadmin') return true;
  if (role !== 'instructor') return false;
  const owner = storedIdString(instructorId);
  const caller = storedIdString(userId);
  return owner !== '' && owner === caller;
}

function presentCourse(course, options) {
  const source = course && typeof course === 'object' ? course : {};
  const rawId = source._id != null ? source._id : source.id;
  const id = rawId != null ? String(rawId) : '';
  const view = { id, _id: id };
  for (const key of COURSE_RESPONSE_FIELDS) {
    if (typeof source[key] === 'string') {
      view[key] = source[key];
    }
  }
  for (const key of OPTIONAL_TEXT_FIELDS) {
    if (typeof source[key] === 'string' && source[key]) view[key] = source[key];
  }
  // Course builder: learning objectives, estimated hours and the module titles (public, like the
  // course title; lesson membership is on each lesson's moduleId).
  if (Array.isArray(source.objectives)) view.objectives = source.objectives.filter((o) => typeof o === 'string');
  if (typeof source.estimatedHours === 'number' && Number.isFinite(source.estimatedHours)) view.estimatedHours = source.estimatedHours;
  if (Array.isArray(source.modules)) view.modules = source.modules.filter((m) => m && typeof m.id === 'string').map((m) => ({ id: m.id, title: typeof m.title === 'string' ? m.title : '' }));
  const instructorId = storedIdString(source.instructorId);
  if (instructorId) view.instructorId = instructorId;
  // Lifecycle state (lib/course-lifecycle.js); a course stored before it existed is published.
  view.status = courseStatus(source);
  const extras = options && typeof options === 'object' ? options : {};
  if (typeof extras.progress === 'number' && Number.isFinite(extras.progress)) {
    view.progress = extras.progress;
  }
  if (typeof extras.enrolled === 'boolean') {
    view.enrolled = extras.enrolled;
  }
  if (extras.completedAt instanceof Date || typeof extras.completedAt === 'string') {
    view.completedAt = extras.completedAt;
  }
  if (Array.isArray(extras.lessons)) {
    view.lessons = extras.lessons;
  }
  // The student's full-course entitlement (paid or granted) and completion (Phase 6).
  if (typeof extras.owned === 'boolean') {
    view.owned = extras.owned;
  }
  if (typeof extras.completed === 'boolean') {
    view.completed = extras.completed;
  }
  return view;
}

module.exports = {
  COURSE_RESPONSE_FIELDS,
  canReadCourseLessons,
  presentCourse,
};

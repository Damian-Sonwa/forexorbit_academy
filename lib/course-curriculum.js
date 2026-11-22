'use strict';

/**
 * Course builder: database operations for the curriculum and the builder's view of a course.
 *
 * Writes follow lib/lesson-order.js: every change to a course's set or sequence of lessons raises
 * `lessonOrderVersion`, and a curriculum change claims the version it was validated against, so two
 * editors cannot interleave changes (409, reload). `order` is always rewritten to the flattened
 * curriculum (lib/course-content.js curriculumOrder), so readers of `order` (navigation, progress,
 * next lesson, certificates) see the same sequence as the builder.
 *
 * Progress stores lesson ids, never positions or modules, so no curriculum change alters progress.
 */

const { ObjectId } = require('mongodb');
const { versionFilter } = require('./lesson-order');
const C = require('./course-content');
const { availableTransitions, courseStatus, decideContentEdit } = require('./course-lifecycle');
const { quizSettings } = require('./quiz-assessment');

const BUILDER_LESSON_LIMIT = 500;

function oid(id) {
  return new ObjectId(String(id));
}

/**
 * Rewrites `order` to the flattened curriculum after a lesson joined a module. Only lessons whose
 * position changes are written. Raises the course's lesson version.
 */
async function normalizeCurriculumOrder(db, courseId) {
  const id = String(courseId);
  const course = await db.collection('courses').findOne({ _id: oid(id) }, { projection: { modules: 1 } });
  if (!course) return false;
  const lessons = await db.collection('lessons').find({ courseId: id }, { projection: { _id: 1, order: 1, moduleId: 1 } }).limit(BUILDER_LESSON_LIMIT + 1).toArray();
  const sequence = C.curriculumOrder(course, lessons);
  const current = new Map(lessons.map((l) => [String(l._id), l.order]));
  const writes = [];
  sequence.forEach((lessonId, index) => {
    if (current.get(lessonId) !== index + 1) {
      writes.push({ updateOne: { filter: { _id: oid(lessonId), courseId: id }, update: { $set: { order: index + 1 } } } });
    }
  });
  if (writes.length) await db.collection('lessons').bulkWrite(writes, { ordered: true });
  await db.collection('courses').updateOne({ _id: oid(id) }, { $inc: { lessonOrderVersion: 1 }, $max: { lessonOrderSeq: sequence.length } });
  return true;
}

/**
 * Applies a checked curriculum (C.checkCurriculum). `version` is the course's lessonOrderVersion
 * the editor loaded. Returns the new version, or null when another change won the race.
 */
async function applyCurriculum(db, { courseId, version, modules, assignments, actorId }) {
  const now = new Date();
  const claimed = await db.collection('courses').findOneAndUpdate(
    { _id: oid(courseId), ...versionFilter(version), deletionStartedAt: { $exists: false } },
    {
      $set: { modules, curriculumUpdatedAt: now, curriculumUpdatedBy: String(actorId || ''), updatedAt: now },
      $inc: { lessonOrderVersion: 1 },
      $max: { lessonOrderSeq: assignments.length },
    },
    { returnDocument: 'after', includeResultMetadata: false, projection: { lessonOrderVersion: 1 } }
  );
  if (!claimed) return null;
  if (assignments.length) {
    await db.collection('lessons').bulkWrite(
      assignments.map((a) => ({
        updateOne: { filter: { _id: oid(a.lessonId), courseId: String(courseId) }, update: { $set: { moduleId: a.moduleId, order: a.order } } },
      })),
      { ordered: true }
    );
  }
  return claimed.lessonOrderVersion;
}

/** Quiz summary per lesson: Map lessonId -> { questions, status }. Bounded by the course's lessons. */
async function quizSummaries(db, lessonIds) {
  if (!lessonIds.length) return new Map();
  const rows = await db.collection('quizzes')
    .find({ lessonId: { $in: lessonIds } }, { projection: { lessonId: 1, questions: 1, settings: 1, status: 1 } })
    .limit(BUILDER_LESSON_LIMIT)
    .toArray();
  return new Map(rows.map((q) => [String(q.lessonId), { questions: Array.isArray(q.questions) ? q.questions.length : 0, status: quizSettings(q).status }]));
}

/** Activities attached to lessons through their own systems (assignments, practical tasks). */
async function lessonActivities(db, courseId) {
  const id = String(courseId);
  const courseKeys = [id, oid(id)];
  const [assignments, tasks] = await Promise.all([
    db.collection('assignments')
      .find({ courseId: { $in: courseKeys }, lessonId: { $type: 'string' } }, { projection: { lessonId: 1, title: 1, status: 1, dueDate: 1, points: 1 } })
      .limit(1000)
      .toArray(),
    db.collection('demoTasks')
      .find({ schema: 'practical_v2', courseId: { $in: courseKeys }, lessonId: { $type: 'string' } }, { projection: { lessonId: 1, title: 1, status: 1, dueAt: 1 } })
      .limit(1000)
      .toArray(),
  ]);
  const byLesson = new Map();
  const slot = (lessonId) => {
    if (!byLesson.has(lessonId)) byLesson.set(lessonId, { assignments: [], practicalTasks: [] });
    return byLesson.get(lessonId);
  };
  for (const a of assignments) {
    slot(String(a.lessonId)).assignments.push({
      id: String(a._id),
      title: typeof a.title === 'string' ? a.title : '',
      status: ['draft', 'published', 'closed'].includes(a.status) ? a.status : 'published',
      dueDate: a.dueDate || null,
      points: typeof a.points === 'number' ? a.points : 100,
    });
  }
  for (const t of tasks) {
    slot(String(t.lessonId)).practicalTasks.push({ id: String(t._id), title: typeof t.title === 'string' ? t.title : '', status: t.status || 'draft', dueAt: t.dueAt || null });
  }
  return byLesson;
}

function presentAsset(a) {
  return { id: a.id, name: a.name || '', kind: a.kind || 'file', mime: a.mime || '', bytes: typeof a.bytes === 'number' ? a.bytes : null, uploadedAt: a.uploadedAt || null };
}

/**
 * The builder's view of one course for a member who owns it (assigned instructor, admin, Super
 * Admin): details, modules with full lessons, uploaded files, activity counts, readiness and what
 * this member may do. Callers check ownership first (decideCourseUpdate rules).
 */
async function loadBuilderCourse(db, member, course) {
  const courseId = String(course._id);
  const lessons = await db.collection('lessons')
    .find({ courseId })
    .sort({ order: 1 })
    .limit(BUILDER_LESSON_LIMIT)
    .toArray();
  const lessonIds = lessons.map((l) => String(l._id));
  const [quizzes, activities] = await Promise.all([quizSummaries(db, lessonIds), lessonActivities(db, courseId)]);
  const assetIds = new Set((Array.isArray(course.assets) ? course.assets : []).map((a) => a.id));
  const readiness = C.courseReadiness({ course, lessons, quizzes, assetIds });
  let instructor = null;
  if (course.instructorId && ObjectId.isValid(String(course.instructorId))) {
    const row = await db.collection('users').findOne({ _id: oid(course.instructorId) }, { projection: { name: 1, email: 1 } });
    instructor = row ? { id: String(row._id), name: row.name || row.email || 'Instructor' } : null;
  }
  const editable = decideContentEdit(member, course).ok;
  const tree = C.curriculum(course, lessons);
  return {
    course: {
      id: courseId,
      title: course.title || '',
      summary: course.summary || '',
      description: course.description || '',
      category: course.category || '',
      difficulty: course.difficulty || '',
      thumbnail: course.thumbnail || '',
      objectives: Array.isArray(course.objectives) ? course.objectives : [],
      prerequisites: course.prerequisites || '',
      estimatedHours: typeof course.estimatedHours === 'number' ? course.estimatedHours : null,
      status: courseStatus(course),
      instructor,
      updatedAt: course.updatedAt || null,
    },
    modules: tree.map((m) => ({ id: m.id, title: m.title, implicit: m.implicit === true, lessonIds: m.lessons.map((l) => String(l._id)) })),
    lessons: lessons.map((l) => {
      const id = String(l._id);
      const act = activities.get(id) || { assignments: [], practicalTasks: [] };
      return {
        id,
        title: l.title || '',
        moduleId: typeof l.moduleId === 'string' ? l.moduleId : null,
        order: l.order || 0,
        blocks: C.lessonBlocks(l),
        usesBlocks: C.usesBlocks(l),
        legacy: { description: typeof l.description === 'string' ? l.description : '', content: typeof l.content === 'string' ? l.content : '' },
        isFreePreview: l.isFreePreview === true,
        revision: Number.isInteger(l.revision) ? l.revision : 0,
        updatedAt: l.updatedAt || null,
        quiz: quizzes.get(id) || null,
        assignments: act.assignments,
        practicalTasks: act.practicalTasks,
        kinds: C.lessonKinds(l),
        minutes: C.readingMinutes(l),
        // AI lesson development: proposals waiting for review (contents load on demand).
        aiPending: (Array.isArray(l.aiProposals) ? l.aiProposals : []).filter((p) => p && p.status === 'pending').length,
      };
    }),
    assets: (Array.isArray(course.assets) ? course.assets : []).map(presentAsset),
    curriculumVersion: Number.isInteger(course.lessonOrderVersion) ? course.lessonOrderVersion : null,
    readiness,
    permissions: {
      editContent: editable,
      transitions: availableTransitions(member, course),
      reassign: member.role === 'admin' || member.role === 'superadmin',
      delete: member.role === 'superadmin',
    },
    truncated: lessons.length >= BUILDER_LESSON_LIMIT,
  };
}

module.exports = {
  BUILDER_LESSON_LIMIT,
  applyCurriculum,
  lessonActivities,
  loadBuilderCourse,
  normalizeCurriculumOrder,
  quizSummaries,
};

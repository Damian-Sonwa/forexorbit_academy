import { unexpectedBody } from '@/lib/public-error';
/**
 * Course Detail API Route
 * GET: Get course by ID (lifecycle visibility: lib/course-lifecycle.js)
 * PUT: Update course (assigned instructor while the course is a draft; admins and superadmins)
 * DELETE: Permanently delete a course (Super Admin only, never with student, payment or
 *         certificate records; see lib/course-deletion.js). Archiving is the normal way to retire a course.
 */

import type { NextApiResponse } from 'next';

/** Rich HTML descriptions can exceed the default 1MB body limit (413 Payload Too Large). */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16mb',
    },
  },
};
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideCourseUpdate, decideLessonRead, isStoredId, presentLessonRead } from '@/lib/account-access';
import { enrollmentDecisionRecord, isActiveEnrollment } from '@/lib/enrollment-state';
import { presentCourse } from '@/lib/course-response';
import { stripCourseVisualAidsFields, stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import { buildLessonsListForCourse } from '@/lib/build-course-lessons-list';
import { availableTransitions, canSeeCourse } from '@/lib/course-lifecycle';
import { decideCourseDeletion, deleteCoursePermanently } from '@/lib/course-deletion';
import { assetsInDocuments, cleanupUnreferencedAssets, removedAssets } from '@/lib/media-cleanup';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { deleteImage } from '@/lib/cloudinary';

const COURSE_MEDIA_FIELDS = ['description', 'thumbnail'];

function refusal(res: NextApiResponse, decision: { status: number; error: string; code?: string; field?: string; dependents?: string[] }) {
  const body: Record<string, unknown> = { error: decision.error };
  if (decision.code) body.code = decision.code;
  if (decision.field) body.field = decision.field;
  if (decision.dependents) body.dependents = decision.dependents;
  return res.status(decision.status).json(body);
}

async function getCourse(req: AuthRequest, res: NextApiResponse) {
  const courseIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(courseIdParam)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  try {
    const db = await getDb();
    const memberFromSession = {
      userId: req.user!.userId,
      role: req.user!.role,
      email: req.user!.email,
    };
    const course = await db.collection('courses').findOne({ _id: new ObjectId(courseIdParam) });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const courseId = String(course._id);
    const member = memberFromSession;
    const enrollment = await db.collection('progress').findOne({
      userId: member.userId,
      $or: [{ courseId }, { courseId: course._id }],
    });
    // A withdrawn enrolment is kept as history but is not an enrolment (audit L1).
    const activeEnrollment = isActiveEnrollment(enrollment);
    if (!canSeeCourse(member, course, { activeEnrollment })) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const enrollmentRecord = enrollmentDecisionRecord(enrollment);
    const courseRecord = {
      _id: course._id,
      instructorId: course.instructorId,
      difficulty: typeof course.difficulty === 'string' ? course.difficulty : null,
      status: course.status,
    };
    // `?lessons=none`: the caller loads lessons from /courses/:id/lessons and needs the course only.
    const withLessons = req.query.lessons !== 'none';
    let lessons: Record<string, unknown>[] | undefined;
    if (withLessons) {
      const courseLessons = await db.collection('lessons')
        .find({ courseId })
        .sort({ order: 1 })
        .toArray();
      const priced = await buildLessonsListForCourse(
        db,
        courseId,
        { userId: member.userId, role: member.role },
        courseLessons as Record<string, unknown>[],
        { explicitPreview: course.freePreviewExplicit === true }
      );
      const pricedById = new Map(priced.map((item) => [String(item._id), item]));
      lessons = courseLessons.map((lesson) => {
        const read = decideLessonRead({
          member,
          lesson: {
            _id: lesson._id,
            courseId: lesson.courseId,
            requiredLevel: typeof lesson.requiredLevel === 'string' ? lesson.requiredLevel : null,
          },
          course: courseRecord,
          enrollment: enrollmentRecord,
        });
        const view = stripLessonVisualAidsFields(
          presentLessonRead(lesson as Record<string, unknown>, read.ok, courseId)
        );
        const price = pricedById.get(String(lesson._id));
        if (price) {
          view.locked = price.locked === true;
          view.isFirstLesson = price.isFirstLesson === true;
          view.isFreePreview = price.isFreePreview === true;
          view.isDemo = price.isDemo === true;
          view.monetization = price.monetization;
          if (price.locked === true) {
            view.content = null;
            view.description = null;
            view.summary = null;
            view.lessonSummary = null;
            view.videoUrl = null;
            view.pdfUrl = null;
            view.resources = [];
          }
        }
        return view;
      });
    }

    const description = typeof course.description === 'string'
      ? String(stripCourseVisualAidsFields({ description: course.description }).description || '')
      : '';
    const coursePayload = presentCourse(
      { ...course, description },
      {
        ...(withLessons ? { lessons } : {}),
        progress: activeEnrollment && typeof enrollment?.progress === 'number' ? Math.min(100, enrollment.progress) : 0,
        enrolled: activeEnrollment,
        completedAt: activeEnrollment && enrollment?.completedAt ? enrollment.completedAt : null,
      }
    );
    // The lifecycle changes this member may make (the server checks every change again).
    if (member.role !== 'student') coursePayload.availableTransitions = availableTransitions(member, course);
    res.json(coursePayload);
  } catch {
    console.error(JSON.stringify({ event: 'courseRead', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function updateCourse(req: AuthRequest, res: NextApiResponse) {
  const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const course = await db.collection('courses').findOne(
      { _id: new ObjectId(courseId) },
      { projection: { instructorId: 1, status: 1, title: 1, description: 1, category: 1, difficulty: 1, thumbnail: 1 } }
    );
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const requestedInstructor = typeof body.instructorId === 'string' ? body.instructorId.trim() : '';
    let assignee = null;
    if (account.ok && (account.user.role === 'admin' || account.user.role === 'superadmin') && isStoredId(requestedInstructor)) {
      const candidate = await db.collection('users').findOne(
        { _id: new ObjectId(requestedInstructor) },
        { projection: { role: 1, status: 1 } }
      );
      assignee = candidate ? { userId: requestedInstructor, role: candidate.role, status: candidate.status } : null;
    }
    const decision = decideCourseUpdate({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      course,
      patch: body,
      assignee,
    });
    if (!decision.ok) {
      return refusal(res, decision);
    }

    // The course must still be in the state that was checked (it may have been submitted for
    // review or archived meanwhile), so an instructor's edit cannot land on a live course.
    const sameState = course!.status === undefined ? { status: { $exists: false } } : { status: course!.status };
    const updated = await db.collection('courses').updateOne(
      { _id: new ObjectId(decision.courseId), ...sameState },
      { $set: { ...decision.patch, updatedAt: new Date() } }
    );
    if (!updated.matchedCount) {
      return res.status(409).json({ error: 'The course changed while you were editing it. Reload and try again.', code: 'course_changed' });
    }
    const dropped = removedAssets(course, { ...course, ...decision.patch }, COURSE_MEDIA_FIELDS);
    if (dropped.length) {
      await cleanupUnreferencedAssets(db, dropped, { destroy: deleteImage, context: { courseId: decision.courseId, reason: 'course_update' } });
    }
    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'courseUpdate', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function deleteCourse(req: AuthRequest, res: NextApiResponse) {
  const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const course = await db.collection('courses').findOne({ _id: new ObjectId(courseId) }, { projection: { status: 1 } });
    const decision = decideCourseDeletion({ member: { userId: req.user!.userId, role: req.user!.role }, course });
    if (!decision.ok) {
      return refusal(res, decision);
    }
    const result = await deleteCoursePermanently(db, {
      courseId: decision.courseId,
      from: decision.from,
      actor: { userId: req.user!.userId, email: req.user!.email },
      assetsOf: (stored, lessons) => [
        ...assetsInDocuments(stored ? [stored] : [], COURSE_MEDIA_FIELDS),
        ...assetsInDocuments(lessons),
      ],
    });
    if (!result.ok) {
      return refusal(res, result);
    }
    console.log(JSON.stringify({ event: 'courseDelete', courseId: decision.courseId, result: 'deleted', ...result.deleted }));
    if (result.assets.length) {
      await cleanupUnreferencedAssets(db, result.assets, { destroy: deleteImage, context: { courseId: decision.courseId, reason: 'course_delete' } });
    }
    res.json({ success: true, deleted: result.deleted });
  } catch {
    console.error(JSON.stringify({ event: 'courseDelete', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getCourse(req, res);
  } else if (req.method === 'PUT') {
    return updateCourse(req, res);
  } else if (req.method === 'DELETE') {
    return deleteCourse(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

import { unexpectedBody } from '@/lib/public-error';
/**
 * Course Detail API Route
 * GET: Get course by ID
 * PUT: Update course (admin/instructor only)
 * DELETE: Delete course (admin only)
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
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';
import { presentCourse } from '@/lib/course-response';
import { stripCourseVisualAidsFields, stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import { buildLessonsListForCourse } from '@/lib/build-course-lessons-list';

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
    const enrollmentRecord = enrollmentDecisionRecord(enrollment);
    const courseRecord = {
      _id: course._id,
      instructorId: course.instructorId,
      difficulty: typeof course.difficulty === 'string' ? course.difficulty : null,
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
        courseLessons as Record<string, unknown>[]
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
        progress: typeof enrollment?.progress === 'number' ? enrollment.progress : 0,
        enrolled: Boolean(enrollment),
      }
    );
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
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const course = await db.collection('courses').findOne(
      { _id: new ObjectId(courseId) },
      { projection: { instructorId: 1 } }
    );
    const decision = decideCourseUpdate({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId } : null,
      patch: req.body,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    await db.collection('courses').updateOne(
      { _id: new ObjectId(decision.courseId) },
      { $set: { ...decision.patch, updatedAt: new Date() } }
    );
    res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'courseUpdate', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function deleteCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    // Allow both admin and superadmin to delete courses
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin or Super Admin only' });
    }

    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');

    await courses.deleteOne({ _id: new ObjectId(id as string) });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete course error:');
    res.status(500).json(unexpectedBody('api', error));
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


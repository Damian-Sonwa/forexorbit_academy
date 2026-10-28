import { unexpectedBody } from '@/lib/public-error';
/**
 * Lessons API Route
 * GET: List lessons for a course
 * POST: Create new lesson (admin/instructor only)
 */

import type { NextApiResponse } from 'next';

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
import { decideAccountAccess, decideLessonCatalog, decideLessonCreate, decideLessonRead, isStoredId, presentLessonRead } from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';
import { stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import { loadCourseEntitlement, presentCourseLessons, priceCourseLessons } from '@/lib/course-lesson-list';

async function getLessons(req: AuthRequest, res: NextApiResponse) {
  const requestedId = Array.isArray(req.query.courseId) ? req.query.courseId[0] : req.query.courseId;
  if (!isStoredId(requestedId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  const outline = req.query.outline === '1' || req.query.outline === 'true';
  try {
    const db = await getDb();
    const member = {
      userId: req.user!.userId,
      role: req.user!.role,
      email: req.user!.email,
    };
    const course = await db.collection('courses').findOne(
      { _id: new ObjectId(requestedId) },
      { projection: { instructorId: 1, difficulty: 1 } }
    );
    const courseId = course ? String(course._id) : '';
    const enrollment = course
      ? await db.collection('progress').findOne({
          userId: member.userId,
          $or: [{ courseId }, { courseId: course._id }],
        })
      : null;
    const enrollmentRecord = enrollmentDecisionRecord(enrollment);
    const catalog = decideLessonCatalog({
      member,
      course: course ? { _id: course._id, instructorId: course.instructorId } : null,
      enrollment: enrollmentRecord,
    });
    if (!catalog.ok) {
      return res.status(catalog.status).json({ error: catalog.error });
    }

    const lessonCursor = db.collection('lessons').find({ courseId: catalog.courseId });
    if (outline) {
      lessonCursor.project({ title: 1, type: 1, order: 1, courseId: 1, requiredLevel: 1 });
    }
    const lessonsList = await lessonCursor.sort({ order: 1 }).toArray();
    const courseRecord = {
      _id: course!._id,
      instructorId: course!.instructorId,
      difficulty: typeof course!.difficulty === 'string' ? course!.difficulty : null,
    };
    if (outline) {
      const outlineViews = lessonsList.map((lesson) => {
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
        return stripLessonVisualAidsFields(presentLessonRead(lesson as Record<string, unknown>, read.ok, catalog.courseId));
      });
      return res.json(outlineViews);
    }
    const entitlement = await loadCourseEntitlement(
      db,
      member,
      catalog.courseId,
      lessonsList.map((lesson) => String(lesson._id))
    );
    const views = presentCourseLessons({
      member,
      course: courseRecord,
      enrollmentRow: enrollment,
      lessons: lessonsList as Record<string, unknown>[],
      pricing: priceCourseLessons(lessonsList, entitlement),
    });
    res.json(views.map(stripLessonVisualAidsFields));
  } catch {
    console.error(JSON.stringify({ event: 'lessonList', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function createLesson(req: AuthRequest, res: NextApiResponse) {
  const courseId = req.body && typeof req.body.courseId === 'string' ? req.body.courseId : '';
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
    const decision = decideLessonCreate({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId } : null,
      body: req.body,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const result = await db.collection('lessons').insertOne({
      ...decision.document,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      courseId: decision.courseId,
      title: decision.document.title,
    });
  } catch {
    console.error(JSON.stringify({ event: 'lessonCreate', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getLessons(req, res);
  } else if (req.method === 'POST') {
    return createLesson(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


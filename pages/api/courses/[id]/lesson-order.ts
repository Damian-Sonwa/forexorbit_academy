/**
 * PUT /api/courses/:id/lesson-order   Body: { lessonIds: string[] }
 *
 * Reorders every lesson of the course at once (positions become 1..n). The list must be exactly
 * the course's current lessons; a reorder that raced another change is refused with 409.
 * See lib/lesson-order.js. Free previews are lesson flags, so no reorder changes which lesson is free.
 */
import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { isStoredId } from '@/lib/account-access';
import { applyLessonReorder, decideLessonReorder } from '@/lib/lesson-order';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { unexpectedBody } from '@/lib/public-error';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const course = await db.collection('courses').findOne(
      { _id: new ObjectId(courseId) },
      { projection: { instructorId: 1, status: 1, lessonOrderVersion: 1 } }
    );
    const current = course
      ? await db.collection('lessons').find({ courseId: String(course._id) }, { projection: { _id: 1 } }).toArray()
      : [];
    const decision = decideLessonReorder({
      member: { userId: req.user!.userId, role: req.user!.role },
      course,
      lessonIds: req.body && typeof req.body === 'object' ? req.body.lessonIds : undefined,
      currentLessonIds: current.map((lesson) => String(lesson._id)),
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error, code: decision.code });
    }
    const applied = await applyLessonReorder(db, {
      courseId: decision.courseId,
      lessonIds: decision.lessonIds,
      version: course!.lessonOrderVersion,
    });
    if (!applied) {
      return res.status(409).json({ error: 'The lessons of this course changed. Reload the page and try again.', code: 'lessons_changed' });
    }
    return res.status(200).json({ success: true, lessonIds: decision.lessonIds });
  } catch {
    console.error(JSON.stringify({ event: 'lessonReorder', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);

/**
 * POST /api/progress/activity  { lessonId, event: 'view' | 'heartbeat' }
 *
 * One learning-activity signal from an open lesson page (Phase 8, lib/learning-activity.js).
 * The student is the session's account; the course is the stored lesson's course; any other
 * field in the body is ignored. Accepted only under the lesson-completion rule (own active
 * enrollment, course open to students, lesson of that course) and the Phase 6 paywall (the
 * lesson must be open to the student). Each minute counts once per student, so repeated or
 * parallel signals cannot add time. Rate limited per account. Staff signals are not recorded.
 */

import type { NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { decideAccountAccess, decideProgressUpdate, isStoredId } from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';
import { courseContentAccess, LESSON_LOCKED_MESSAGE } from '@/lib/course-lesson-list';
import { ACTIVITY_EVENTS, recordActivity } from '@/lib/learning-activity';
import { activityLimiter, allowRequest } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

async function handler(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const lessonId = typeof body.lessonId === 'string' ? body.lessonId : '';
  const event = typeof body.event === 'string' ? body.event : '';
  if (!isStoredId(lessonId) || !(ACTIVITY_EVENTS as readonly string[]).includes(event)) {
    return res.status(400).json({ error: 'Invalid activity' });
  }
  if (req.user!.role !== 'student') return res.status(200).json({ recorded: false });
  try {
    const db = await getDb();
    if (!(await allowRequest(activityLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const lesson = await db.collection('lessons').findOne({ _id: new ObjectId(lessonId) }, { projection: { courseId: 1 } });
    const course = lesson && isStoredId(String(lesson.courseId))
      ? await db.collection('courses').findOne({ _id: new ObjectId(String(lesson.courseId)) }, { projection: { instructorId: 1, status: 1 } })
      : null;
    const enrollment = account.ok && course
      ? await db.collection('progress').findOne({ userId: account.user.userId, $or: [{ courseId: String(course._id) }, { courseId: course._id }] })
      : null;
    const decision = decideProgressUpdate({
      member: account.ok ? account.user : null,
      course: course ? { _id: course._id, status: course.status } : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      enrollment: enrollmentDecisionRecord(enrollment),
    });
    if (!decision.ok) return res.status(decision.status).json({ error: decision.error });
    const access = await courseContentAccess(db, account.ok ? account.user : null, decision.courseId);
    if (!access.isOpen(decision.lessonId)) {
      return res.status(403).json({ error: LESSON_LOCKED_MESSAGE, code: 'lesson_locked' });
    }
    const result = await recordActivity(db, {
      userId: decision.userId,
      courseId: decision.courseId,
      lessonId: decision.lessonId,
      event: event as 'view' | 'heartbeat',
    });
    return res.status(200).json({ recorded: true, newMinute: result.newMinute });
  } catch {
    console.error(JSON.stringify({ event: 'learningActivity', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(handler);

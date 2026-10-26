import { unexpectedBody } from '@/lib/public-error';
import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  decideEnroll,
  decideUnenroll,
  enrollDuplicateStatus,
  isStoredCourseId,
} from '@/lib/enrollment-state';

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredCourseId(courseId)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }

  try {
    const db = await getDb();
    const courses = db.collection('courses');
    const progress = db.collection('progress');
    const userId = req.user!.userId;
    const courseObjectId = new ObjectId(courseId);
    const existing = await progress.findOne({
      userId,
      $or: [{ courseId }, { courseId: courseObjectId }],
    });

    if (req.method === 'POST') {
      const course = await courses.findOne({ _id: courseObjectId });
      const decision = decideEnroll({
        role: req.user!.role,
        userId,
        courseId,
        course,
        existing,
      });
      if (!decision.ok || !decision.writes) {
        return res.status(decision.status).json({ error: decision.error });
      }
      try {
        if (decision.action === 'reactivate') {
          await progress.updateOne(
            { _id: existing!._id, userId },
            { $set: { active: true, updatedAt: new Date() }, $unset: { withdrawnAt: '' } }
          );
        } else {
          await progress.insertOne({
            ...decision.document,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      } catch (writeError) {
        const duplicate = enrollDuplicateStatus(writeError as { code?: unknown; codeName?: unknown });
        return res.status(duplicate.status).json(duplicate.body);
      }
      return res.status(200).json({ success: true, enrolled: true });
    }

    const decision = decideUnenroll({
      role: req.user!.role,
      userId,
      courseId,
      existing,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    if (decision.action === 'withdraw' && existing) {
      await progress.updateOne(
        { _id: existing._id, userId },
        { $set: { active: false, withdrawnAt: new Date(), updatedAt: new Date() } }
      );
    }
    return res.status(200).json({ success: true, enrolled: false });
  } catch {
    return res.status(500).json(unexpectedBody('api'));
  }
}, ['student']);

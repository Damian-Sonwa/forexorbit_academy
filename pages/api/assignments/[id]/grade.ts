import { unexpectedBody } from '@/lib/public-error';
/**
 * Assignment Grading API Route
 * POST: Grade a submission on a course the caller owns
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideAssignmentGrade, isStoredId } from '@/lib/account-access';

async function gradeAssignment(req: AuthRequest, res: NextApiResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : '';
  if (!isStoredId(id) || !isStoredId(submissionId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const db = await getDb();
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const assignment = await db.collection('assignments').findOne({ _id: new ObjectId(id) });
    const courseId = assignment && isStoredId(String(assignment.courseId)) ? String(assignment.courseId) : '';
    const course = courseId
      ? await db.collection('courses').findOne(
          { _id: new ObjectId(courseId) },
          { projection: { instructorId: 1, status: 1 } }
        )
      : null;
    const submission = await db.collection('assignmentSubmissions').findOne({ _id: new ObjectId(submissionId) });
    const decision = decideAssignmentGrade({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      course: course ? { _id: course._id, instructorId: course.instructorId, status: course.status } : null,
      assignment: assignment ? { _id: assignment._id, courseId: assignment.courseId, points: assignment.points } : null,
      submission: submission ? { _id: submission._id, assignmentId: submission.assignmentId, userId: submission.userId } : null,
      grade: body.grade,
      feedback: body.feedback,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    await db.collection('assignmentSubmissions').updateOne(
      { _id: new ObjectId(decision.submissionId), assignmentId: id },
      {
        $set: {
          grade: decision.grade,
          feedback: decision.feedback,
          gradedBy: decision.gradedBy,
          gradedAt: new Date(),
          status: 'graded',
          updatedAt: new Date(),
        },
      }
    );
    if (decision.points && isStoredId(decision.userId)) {
      const pointsEarned = Math.round((decision.grade / 100) * decision.points);
      await db.collection('users').updateOne(
        { _id: new ObjectId(decision.userId) },
        { $inc: { points: pointsEarned } }
      );
    }
    return res.json({ success: true, message: 'Assignment graded successfully' });
  } catch {
    console.error(JSON.stringify({ event: 'assignmentGrade', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(gradeAssignment);

import { unexpectedBody } from '@/lib/public-error';
/**
 * Assignment Grading API Route
 * POST: Grade a submission on a course the caller owns
 *
 * Phase 9 (docs/audits/phase-9-assessments.md, section 9):
 * - who may grade is unchanged: the course instructor, admins and the Super Admin
 *   (decideAssignmentGrade); the submission must belong to this assignment;
 * - grades 0-100, feedback at most 5000 characters;
 * - every grade is appended to `gradeHistory` (grade, feedback, grader, time, previous grade) by
 *   one conditional update, so concurrent or repeated grading cannot lose an entry;
 * - points: only the difference to what this submission already awarded (`pointsAwarded`), so a
 *   regrade never adds the points again; the award is recoverable (settlePendingPoints), so an
 *   interrupted one is finished by the next grade or the sweep, never lost or repeated;
 * - a grade applies only to the work the grader read: a resubmission in between is a 409;
 * - the student is notified (existing notification feed + their live room).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId, type Document, type UpdateFilter } from 'mongodb';
import { decideAccountAccess, decideAssignmentGrade, isStoredId } from '@/lib/account-access';
import { gradePoints, previouslyAwarded, settlePendingPoints } from '@/lib/assignment-grading';
import { createNotification } from '@/lib/notifications';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';

async function gradeAssignment(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : '';
  if (!isStoredId(id) || !isStoredId(submissionId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
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
    if (decision.userId === decision.gradedBy) {
      return res.status(403).json({ error: 'You cannot grade your own submission.' });
    }
    await settlePendingPoints(db, submission);
    const now = new Date();
    const award = gradePoints(decision.grade, decision.points);
    const before = previouslyAwarded(submission as Record<string, unknown> | null, decision.points);
    const version = typeof submission!.gradeVersion === 'number' ? submission!.gradeVersion : 0;
    const delta = award - before;
    const nextVersion = version + 1;
    const lastVersions = Array.isArray(submission!.previousVersions) ? submission!.previousVersions : [];
    const lastGrade = lastVersions.length ? lastVersions[lastVersions.length - 1].grade : null;
    const pointsPending = delta !== 0 && isStoredId(decision.userId)
      ? { key: `${decision.submissionId}:grade:${nextVersion}`, delta }
      : null;
    // Conditional on the version read above: a concurrent grade makes this one retry instead of
    // overwriting it, so the history and the points stay consistent.
    const gradeUpdate = {
      $set: {
        grade: decision.grade,
        feedback: decision.feedback,
        gradedBy: decision.gradedBy,
        gradedAt: now,
        status: 'graded',
        pointsAwarded: award,
        gradeVersion: nextVersion,
        updatedAt: now,
        ...(pointsPending ? { pointsPending } : {}),
      },
      $push: {
        gradeHistory: {
          grade: decision.grade,
          feedback: decision.feedback,
          gradedBy: decision.gradedBy,
          gradedAt: now,
          previousGrade: typeof submission!.grade === 'number' ? submission!.grade : typeof lastGrade === 'number' ? lastGrade : null,
          pointsAwarded: award,
        },
      },
    } as unknown as UpdateFilter<Document>;
    const updated = await db.collection('assignmentSubmissions').updateOne(
      {
        _id: new ObjectId(decision.submissionId),
        assignmentId: id,
        submittedAt: submission!.submittedAt ?? null,
        ...(version ? { gradeVersion: version } : { gradeVersion: { $exists: false } }),
      },
      gradeUpdate
    );
    if (!updated.matchedCount) {
      return res.status(409).json({ error: 'This submission changed while you were grading it. Reload and try again.', code: 'submission_changed' });
    }
    if (pointsPending) await settlePendingPoints(db, { _id: submission!._id, userId: decision.userId, pointsPending });
    try {
      const title = typeof assignment!.title === 'string' && assignment!.title ? assignment!.title : 'your assignment';
      await createNotification({
        type: 'task_feedback',
        title: 'Assignment graded',
        message: `Your submission for ${title} has been graded.`,
        userId: decision.userId,
        relatedId: id,
        roleTarget: 'student',
        metadata: { assignmentId: id, grade: decision.grade },
      });
      req.io?.to(`user:${decision.userId}`).emit('notification', {
        type: 'task_feedback',
        title: 'Assignment graded',
        message: `Your submission for ${title} has been graded.`,
        read: false,
        createdAt: now,
      });
    } catch {
      // The grade is saved; a failed notification must not undo it.
      console.error(JSON.stringify({ event: 'assignmentGradeNotify', result: 'failed' }));
    }
    return res.json({ success: true, message: 'Assignment graded successfully', grade: decision.grade, pointsAwarded: award });
  } catch {
    console.error(JSON.stringify({ event: 'assignmentGrade', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

export default withAuth(gradeAssignment);

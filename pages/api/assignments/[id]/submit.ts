import { unexpectedBody } from '@/lib/public-error';
/**
 * Assignment Submission API Route
 * POST: Submit the authenticated student's own work
 * GET: Read that student's own submission
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  decideAccountAccess,
  decideAssignmentRead,
  decideAssignmentSubmit,
  isStoredId,
  presentSubmission,
} from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';

async function loadSubmissionContext(req: AuthRequest, id: string) {
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
        { projection: { instructorId: 1 } }
      )
    : null;
  const enrollment = account.ok && course
    ? await db.collection('progress').findOne({
        userId: account.user.userId,
        $or: [{ courseId }, { courseId: course._id }],
      })
    : null;
  return { db, account, assignment, course, enrollment };
}

async function submitAssignment(req: AuthRequest, res: NextApiResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(id)) {
    return res.status(400).json({ error: 'Invalid assignment ID' });
  }
  try {
    const loaded = await loadSubmissionContext(req, id);
    const decision = decideAssignmentSubmit({
      member: loaded.account.ok ? { userId: loaded.account.user.userId, role: loaded.account.user.role } : null,
      course: loaded.course ? { _id: loaded.course._id, instructorId: loaded.course.instructorId } : null,
      enrollment: enrollmentDecisionRecord(loaded.enrollment),
      assignment: loaded.assignment ? {
        _id: loaded.assignment._id,
        courseId: loaded.assignment.courseId,
        lessonId: loaded.assignment.lessonId,
        points: loaded.assignment.points,
      } : null,
      body: req.body,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const submissions = loaded.db.collection('assignmentSubmissions');
    const existing = await submissions.findOne({
      userId: decision.userId,
      assignmentId: decision.assignmentId,
    });
    if (existing) {
      await submissions.updateOne(
        { userId: decision.userId, assignmentId: decision.assignmentId },
        {
          $set: {
            submissionText: decision.submissionText,
            submissionFile: decision.submissionFile,
            submittedAt: new Date(),
            status: 'submitted',
            updatedAt: new Date(),
          },
        }
      );
    } else {
      await submissions.insertOne({
        userId: decision.userId,
        assignmentId: decision.assignmentId,
        courseId: decision.courseId,
        lessonId: decision.lessonId,
        submissionText: decision.submissionText,
        submissionFile: decision.submissionFile,
        status: 'submitted',
        grade: null,
        feedback: null,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await loaded.db.collection('users').updateOne(
        { _id: new ObjectId(decision.userId) },
        { $inc: { points: decision.points || 0 } }
      );
    }
    return res.json({ success: true, message: 'Assignment submitted successfully' });
  } catch {
    console.error(JSON.stringify({ event: 'assignmentSubmit', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

async function getSubmission(req: AuthRequest, res: NextApiResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(id)) {
    return res.status(400).json({ error: 'Invalid assignment ID' });
  }
  try {
    const loaded = await loadSubmissionContext(req, id);
    const access = decideAssignmentRead({
      member: loaded.account.ok ? { userId: loaded.account.user.userId, role: loaded.account.user.role } : null,
      course: loaded.course ? { _id: loaded.course._id, instructorId: loaded.course.instructorId } : null,
      enrollment: enrollmentDecisionRecord(loaded.enrollment),
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    if (access.staff) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const submission = await loaded.db.collection('assignmentSubmissions').findOne({
      userId: access.courseId && loaded.account.ok ? loaded.account.user.userId : '',
      assignmentId: id,
    });
    if (!submission || submission.userId !== (loaded.account.ok ? loaded.account.user.userId : '')) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    return res.json(presentSubmission(submission));
  } catch {
    console.error(JSON.stringify({ event: 'assignmentSubmissionRead', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'POST') return submitAssignment(req, res);
  if (req.method === 'GET') return getSubmission(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);

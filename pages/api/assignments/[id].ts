import { unexpectedBody } from '@/lib/public-error';
/**
 * Assignment API Route (Single Assignment)
 * GET: Get assignment details for an authorized course member
 * PUT: Update assignment for the assigned instructor, an admin, or a superadmin
 * DELETE: Delete that assignment and its submissions
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  decideAccountAccess,
  decideAssignmentMutation,
  decideAssignmentRead,
  isStoredId,
  presentAssignment,
  presentSubmission,
} from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';

async function loadAssignment(req: AuthRequest, id: string) {
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

function memberOf(account: { ok: true; user: { userId: string; role: string } } | { ok: false }) {
  return account.ok ? { userId: account.user.userId, role: account.user.role } : null;
}

async function getAssignment(req: AuthRequest, res: NextApiResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(id)) {
    return res.status(400).json({ error: 'Invalid assignment ID' });
  }
  try {
    const loaded = await loadAssignment(req, id);
    const access = decideAssignmentRead({
      member: memberOf(loaded.account),
      course: loaded.course ? { _id: loaded.course._id, instructorId: loaded.course.instructorId } : null,
      enrollment: enrollmentDecisionRecord(loaded.enrollment),
    });
    if (!loaded.assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    if (!access.ok || !loaded.course || String(loaded.assignment.courseId) !== access.courseId) {
      return res.status(access.ok ? 404 : access.status).json({ error: access.ok ? 'Assignment not found' : access.error });
    }
    const view = presentAssignment(loaded.assignment, access.staff);
    if (access.staff) {
      const submissions = await loaded.db.collection('assignmentSubmissions').find({ assignmentId: id }).toArray();
      return res.json({ ...view, submissions: submissions.map((submission) => presentSubmission(submission)) });
    }
    const submission = await loaded.db.collection('assignmentSubmissions').findOne({
      userId: loaded.account.ok ? loaded.account.user.userId : '',
      assignmentId: id,
    });
    return res.json(presentAssignment(loaded.assignment, false, submission));
  } catch {
    console.error(JSON.stringify({ event: 'assignmentRead', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

async function updateAssignment(req: AuthRequest, res: NextApiResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(id)) {
    return res.status(400).json({ error: 'Invalid assignment ID' });
  }
  try {
    const loaded = await loadAssignment(req, id);
    const decision = decideAssignmentMutation({
      member: memberOf(loaded.account),
      course: loaded.course ? { _id: loaded.course._id, instructorId: loaded.course.instructorId } : null,
      assignment: loaded.assignment ? { _id: loaded.assignment._id, courseId: loaded.assignment.courseId } : null,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.title === 'string' && body.title.trim()) updateData.title = body.title.trim();
    if (typeof body.description === 'string') updateData.description = body.description;
    if (typeof body.instructions === 'string' && body.instructions.trim()) updateData.instructions = body.instructions.trim();
    if (typeof body.dueDate === 'string' && body.dueDate) updateData.dueDate = new Date(body.dueDate);
    if (typeof body.points === 'number' && Number.isFinite(body.points) && body.points >= 0) updateData.points = body.points;
    await loaded.db.collection('assignments').updateOne(
      { _id: new ObjectId(decision.assignmentId) },
      { $set: updateData }
    );
    return res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'assignmentUpdate', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

async function deleteAssignment(req: AuthRequest, res: NextApiResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!isStoredId(id)) {
    return res.status(400).json({ error: 'Invalid assignment ID' });
  }
  try {
    const loaded = await loadAssignment(req, id);
    const decision = decideAssignmentMutation({
      member: memberOf(loaded.account),
      course: loaded.course ? { _id: loaded.course._id, instructorId: loaded.course.instructorId } : null,
      assignment: loaded.assignment ? { _id: loaded.assignment._id, courseId: loaded.assignment.courseId } : null,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    await loaded.db.collection('assignments').deleteOne({ _id: new ObjectId(decision.assignmentId) });
    await loaded.db.collection('assignmentSubmissions').deleteMany({ assignmentId: decision.assignmentId });
    return res.json({ success: true });
  } catch {
    console.error(JSON.stringify({ event: 'assignmentDelete', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getAssignment(req, res);
  if (req.method === 'PUT') return updateAssignment(req, res);
  if (req.method === 'DELETE') return deleteAssignment(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);

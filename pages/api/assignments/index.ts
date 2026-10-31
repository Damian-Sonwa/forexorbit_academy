import { unexpectedBody } from '@/lib/public-error';
/**
 * Assignments API Route
 * GET: List assignments for a course the caller can open
 * POST: Create assignment for a course the caller owns
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  decideAccountAccess,
  decideAssignmentCreate,
  decideAssignmentRead,
  isStoredId,
  presentAssignment,
} from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';

async function loadCourseAccess(req: AuthRequest, courseId: string) {
  const db = await getDb();
  const record = await db.collection('users').findOne(
    { _id: new ObjectId(req.user!.userId) },
    { projection: { email: 1, role: 1, status: 1 } }
  );
  const account = decideAccountAccess({ userId: req.user!.userId, record });
  const course = await db.collection('courses').findOne(
    { _id: new ObjectId(courseId) },
    { projection: { instructorId: 1, status: 1 } }
  );
  const enrollment = account.ok && course
    ? await db.collection('progress').findOne({
        userId: account.user.userId,
        $or: [{ courseId }, { courseId: course._id }],
      })
    : null;
  return { db, account, course, enrollment };
}

async function getAssignments(req: AuthRequest, res: NextApiResponse) {
  const requestedCourse = Array.isArray(req.query.courseId) ? req.query.courseId[0] : req.query.courseId;
  const requestedLesson = Array.isArray(req.query.lessonId) ? req.query.lessonId[0] : req.query.lessonId;
  if (requestedCourse && !isStoredId(requestedCourse)) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  if (requestedLesson && !isStoredId(requestedLesson)) {
    return res.status(400).json({ error: 'Invalid lesson ID' });
  }
  if (!requestedCourse && !requestedLesson) {
    return res.status(400).json({ error: 'Course ID is required' });
  }
  try {
    const db = await getDb();
    let courseId = requestedCourse || '';
    if (requestedLesson) {
      const lesson = await db.collection('lessons').findOne(
        { _id: new ObjectId(requestedLesson) },
        { projection: { courseId: 1 } }
      );
      if (!lesson || !isStoredId(String(lesson.courseId))) {
        return res.status(404).json({ error: 'Lesson not found' });
      }
      if (courseId && courseId !== String(lesson.courseId)) {
        return res.status(400).json({ error: 'Invalid course ID' });
      }
      courseId = String(lesson.courseId);
    }
    const loaded = await loadCourseAccess(req, courseId);
    const access = decideAssignmentRead({
      member: loaded.account.ok ? { userId: loaded.account.user.userId, role: loaded.account.user.role } : null,
      course: loaded.course ? { _id: loaded.course._id, instructorId: loaded.course.instructorId, status: loaded.course.status } : null,
      enrollment: enrollmentDecisionRecord(loaded.enrollment),
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const query: Record<string, unknown> = { courseId: access.courseId };
    if (requestedLesson) query.lessonId = requestedLesson;
    const assignmentsList = await loaded.db.collection('assignments').find(query).sort({ dueDate: 1 }).toArray();
    if (access.staff) {
      return res.json(assignmentsList.map((assignment) => presentAssignment(assignment, true)));
    }
    const submissions = loaded.db.collection('assignmentSubmissions');
    const views = await Promise.all(assignmentsList.map(async (assignment) => {
      const submission = await submissions.findOne({
        userId: loaded.account.ok ? loaded.account.user.userId : '',
        assignmentId: assignment._id.toString(),
      });
      return presentAssignment(assignment, false, submission);
    }));
    return res.json(views);
  } catch {
    console.error(JSON.stringify({ event: 'assignmentList', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

async function createAssignment(req: AuthRequest, res: NextApiResponse) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const courseId = typeof body.courseId === 'string' ? body.courseId : '';
  const lessonId = typeof body.lessonId === 'string' ? body.lessonId.trim() : '';
  if (!isStoredId(courseId) || (lessonId && !isStoredId(lessonId))) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }
  try {
    const loaded = await loadCourseAccess(req, courseId);
    const lesson = lessonId
      ? await loaded.db.collection('lessons').findOne(
          { _id: new ObjectId(lessonId) },
          { projection: { courseId: 1 } }
        )
      : null;
    const decision = decideAssignmentCreate({
      member: loaded.account.ok ? { userId: loaded.account.user.userId, role: loaded.account.user.role } : null,
      course: loaded.course ? { _id: loaded.course._id, instructorId: loaded.course.instructorId, status: loaded.course.status } : null,
      lesson: lesson ? { _id: lesson._id, courseId: lesson.courseId } : null,
      body,
    });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const result = await loaded.db.collection('assignments').insertOne({
      ...decision.document,
      dueDate: decision.document.dueDate ? new Date(decision.document.dueDate) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return res.status(201).json({
      id: result.insertedId.toString(),
      ...decision.document,
      dueDate: decision.document.dueDate ? new Date(decision.document.dueDate) : null,
    });
  } catch {
    console.error(JSON.stringify({ event: 'assignmentCreate', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getAssignments(req, res);
  } else if (req.method === 'POST') {
    return createAssignment(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);

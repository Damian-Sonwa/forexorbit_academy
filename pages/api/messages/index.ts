import { unexpectedBody } from '@/lib/public-error';
/**
 * Messages API Route
 * GET: Get messages for a lesson room
 * POST: Send a message
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideLessonChat, decideLessonMessageRead } from '@/lib/account-access';
import { enrollmentDecisionRecord } from '@/lib/enrollment-state';

function lessonIdFrom(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

async function loadLessonMessageContext(userId: string, lessonId: string) {
  const db = await getDb();
  const record = await db.collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { email: 1, role: 1, status: 1, name: 1 } }
  );
  const account = decideAccountAccess({ userId, record });
  const lesson = await db.collection('lessons').findOne(
    { _id: new ObjectId(lessonId) },
    { projection: { courseId: 1, requiredLevel: 1 } }
  );
  let course = null;
  let enrollment = null;
  if (lesson && lesson.courseId != null && ObjectId.isValid(String(lesson.courseId))) {
    course = await db.collection('courses').findOne(
      { _id: new ObjectId(String(lesson.courseId)) },
      { projection: { instructorId: 1, difficulty: 1, status: 1 } }
    );
    if (account.ok && course) {
      const courseId = String(course._id);
      enrollment = await db.collection('progress').findOne({
        userId: account.user.userId,
        $or: [{ courseId }, { courseId: course._id }],
      });
    }
  }
  return {
    member: account.ok ? {
      userId: account.user.userId,
      role: account.user.role,
      email: account.user.email,
      name: record && typeof record.name === 'string' ? record.name : '',
    } : null,
    lesson: lesson ? {
      _id: lesson._id,
      courseId: lesson.courseId,
      requiredLevel: typeof lesson.requiredLevel === 'string' ? lesson.requiredLevel : null,
    } : null,
    course: course ? {
      _id: course._id,
      instructorId: course.instructorId,
      difficulty: typeof course.difficulty === 'string' ? course.difficulty : null,
      status: course.status,
    } : null,
    enrollment: enrollmentDecisionRecord(enrollment),
  };
}

async function getMessages(req: AuthRequest, res: NextApiResponse) {
  const lessonId = lessonIdFrom(req.query.lessonId);
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'lessonId required' });
  }

  try {
    const loaded = await loadLessonMessageContext(req.user!.userId, lessonId);
    const decision = decideLessonMessageRead(loaded);
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const db = await getDb();
    const messagesList = await db.collection('messages')
      .find({ lessonId: decision.lessonId })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();

    res.json(messagesList);
  } catch {
    console.error(JSON.stringify({ event: 'lessonMessages', result: 'lookup_failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function sendMessage(req: AuthRequest, res: NextApiResponse) {
  const lessonId = typeof req.body?.lessonId === 'string' ? req.body.lessonId : '';
  const text = req.body?.text;
  if (!ObjectId.isValid(lessonId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const loaded = await loadLessonMessageContext(req.user!.userId, lessonId);
    const read = decideLessonMessageRead(loaded);
    if (!read.ok) {
      return res.status(read.status).json({ error: read.error });
    }
    const decision = decideLessonChat({
      member: loaded.member,
      lesson: loaded.lesson,
      course: loaded.course,
      enrollment: loaded.enrollment,
      text,
    });
    if (!decision.ok) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const createdAt = new Date();
    const result = await db.collection('messages').insertOne({
      lessonId: decision.lessonId,
      userId: decision.sender.userId,
      senderName: decision.sender.senderName,
      text: decision.text,
      createdAt,
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      lessonId: decision.lessonId,
      userId: decision.sender.userId,
      senderName: decision.sender.senderName,
      text: decision.text,
      createdAt,
    });
  } catch {
    console.error(JSON.stringify({ event: 'lessonMessages', result: 'failed' }));
    res.status(500).json(unexpectedBody('api'));
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getMessages(req, res);
  } else if (req.method === 'POST') {
    return sendMessage(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);

/**
 * Classes/Events API Route
 * GET: Get upcoming classes
 * POST: Create new class/event
 * PUT: Update class/event
 * DELETE: Delete class/event
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { canReadCourseLessons } from '@/lib/course-response';
import { isActiveEnrollment } from '@/lib/enrollment-state';
import { planClassNotification } from '@/lib/class-notifications';
import { deliverNotification } from '@/lib/notifications';

const CLASS_ERROR = 'Internal server error';

function storedCourseId(value: unknown): string {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value) ? value : '';
}

async function notifyClass(req: AuthRequest, db: Awaited<ReturnType<typeof import('@/lib/mongodb').getDb>>, action: string, classDoc: { [key: string]: any }) {
  const courseId = storedCourseId(classDoc.courseId);
  if (!courseId) return;
  const course = await db.collection('courses').findOne(
    { _id: new ObjectId(courseId) },
    { projection: { instructorId: 1 } }
  );
  if (!course || !canReadCourseLessons(req.user!.role, req.user!.userId, course.instructorId)) return;
  const rows = await db.collection('progress').find({
    $or: [{ courseId }, { courseId: course._id }],
  }).toArray();
  const plan = planClassNotification({
    action,
    classId: String(classDoc._id),
    courseId,
    title: classDoc.title,
    date: classDoc.date,
    time: classDoc.time,
    activeStudentIds: rows.filter((row) => isActiveEnrollment(row)).map((row) => String(row.userId)),
  });
  if (!plan.notify) return;
  const delivered = await deliverNotification({
    type: 'live_class_reminder',
    title: plan.title || 'Class update',
    message: plan.message || 'A class was updated.',
    relatedId: String(classDoc._id),
    dedupeKey: plan.dedupeKey,
    metadata: { classId: String(classDoc._id), courseId, href: plan.href },
  }, plan.recipients);
  if (!req.io) return;
  delivered.forEach((item) => {
    if (!item.created) return;
    req.io!.to(`user:${item.userId}`).emit('notification', {
      type: 'live_class_reminder',
      title: plan.title,
      message: plan.message,
      relatedId: String(classDoc._id),
      read: false,
      createdAt: new Date(),
    });
  });
}

async function getClasses(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const classes = db.collection('classes');

    // Get all upcoming classes (date >= today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingClasses = await classes
      .find({
        date: { $gte: today.toISOString() },
      })
      .sort({ date: 1, time: 1 })
      .toArray();

    res.json(upcomingClasses.map(cls => ({
      _id: cls._id.toString(),
      title: cls.title,
      description: cls.description,
      date: cls.date,
      time: cls.time,
      meetingLink: cls.meetingLink,
      courseId: cls.courseId || '',
      createdBy: cls.createdBy,
      createdAt: cls.createdAt,
      updatedAt: cls.updatedAt,
    })));
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'classes.list', result: 'failed' }));
    res.status(500).json({ error: CLASS_ERROR });
  }
}

async function createClass(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can create classes
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can create classes' });
    }

    const { title, description, date, time, meetingLink } = req.body;
    const storedCourse = storedCourseId(req.body?.courseId);

    if (!title || !description || !date || !time) {
      return res.status(400).json({ error: 'Title, description, date, and time are required' });
    }

    const db = await getDb();
    const classes = db.collection('classes');

    const newClass = {
      title,
      description,
      date: new Date(date).toISOString(),
      time,
      meetingLink: meetingLink || '',
      courseId: storedCourse,
      createdBy: req.user!.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await classes.insertOne(newClass);
    await notifyClass(req, db, 'created', { ...newClass, _id: result.insertedId });

    res.status(201).json({
      _id: result.insertedId.toString(),
      ...newClass,
    });
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'classes.create', result: 'failed' }));
    res.status(500).json({ error: CLASS_ERROR });
  }
}

async function updateClass(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can update classes
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can update classes' });
    }

    const { id } = req.query;
    const { title, description, date, time, meetingLink } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Class ID is required' });
    }

    const db = await getDb();
    const classes = db.collection('classes');

    // Check if class exists and was created by this user (or user is admin)
    const existingClass = await classes.findOne({ _id: new ObjectId(id) });
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (req.user!.role !== 'admin' && existingClass.createdBy !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only update your own classes' });
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (date) updateData.date = new Date(date).toISOString();
    if (time) updateData.time = time;
    if (meetingLink !== undefined) updateData.meetingLink = meetingLink;
    const nextCourse = storedCourseId(req.body.courseId);
    if (nextCourse) updateData.courseId = nextCourse;

    await classes.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    if (updateData.date || updateData.time) {
      await notifyClass(req, db, 'rescheduled', { ...existingClass, ...updateData, _id: existingClass._id });
    }

    res.json({ success: true, message: 'Class updated successfully' });
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'classes.update', result: 'failed' }));
    res.status(500).json({ error: CLASS_ERROR });
  }
}

async function deleteClass(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can delete classes
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can delete classes' });
    }

    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Class ID is required' });
    }

    const db = await getDb();
    const classes = db.collection('classes');

    // Check if class exists and was created by this user (or user is admin)
    const existingClass = await classes.findOne({ _id: new ObjectId(id) });
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (req.user!.role !== 'admin' && existingClass.createdBy !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only delete your own classes' });
    }

    await notifyClass(req, db, 'cancelled', existingClass);
    await classes.deleteOne({ _id: new ObjectId(id) });

    res.json({ success: true, message: 'Class deleted successfully' });
  } catch (error: unknown) {
    console.error(JSON.stringify({ event: 'classes.delete', result: 'failed' }));
    res.status(500).json({ error: CLASS_ERROR });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getClasses(req, res);
  } else if (req.method === 'POST') {
    return createClass(req, res);
  } else if (req.method === 'PUT') {
    return updateClass(req, res);
  } else if (req.method === 'DELETE') {
    return deleteClass(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});


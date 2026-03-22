/**
 * Course Detail API Route
 * GET: Get course by ID
 * PUT: Update course (admin/instructor only)
 * DELETE: Delete course (admin only)
 */

import type { NextApiResponse } from 'next';

/** Rich HTML descriptions can exceed the default 1MB body limit (413 Payload Too Large). */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16mb',
    },
  },
};
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { stripCourseVisualAidsFields } from '@/lib/strip-visual-aids-html';
import { buildLessonsListForCourse } from '@/lib/build-course-lessons-list';

async function getCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');
    const progress = db.collection('progress');

    const course = await courses.findOne({ _id: new ObjectId(id as string) });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    let userProgress: { progress?: number } | null = null;
    if (req.user) {
      userProgress = (await progress.findOne({
        userId: req.user.userId,
        courseId: id,
      })) as { progress?: number } | null;
    }

    const lessonsOut = await buildLessonsListForCourse(db, id as string, req.user);

    const coursePayload = {
      ...stripCourseVisualAidsFields(course as Record<string, unknown>),
      lessons: lessonsOut,
    };

    if (req.user) {
      (coursePayload as Record<string, unknown>).progress = userProgress?.progress || 0;
      (coursePayload as Record<string, unknown>).enrolled = !!userProgress;
    }

    res.json(coursePayload);
  } catch (error: any) {
    console.error('Get course error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function updateCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');

    // Check if course exists
    const course = await courses.findOne({ _id: new ObjectId(id as string) });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Instructors, admins, and superadmins can edit any course
    const userRole = req.user!.role;
    console.log('Update course - User role:', userRole, 'User:', req.user!.email);
    if (userRole !== 'admin' && userRole !== 'instructor' && userRole !== 'superadmin') {
      console.log('Access denied - Role not authorized:', userRole);
      return res.status(403).json({ message: 'Not authorized', role: userRole });
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };

    await courses.updateOne(
      { _id: new ObjectId(id as string) },
      { $set: updateData }
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update course error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function deleteCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    // Allow both admin and superadmin to delete courses
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ message: 'Admin or Super Admin only' });
    }

    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');

    await courses.deleteOne({ _id: new ObjectId(id as string) });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete course error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getCourse(req, res);
  } else if (req.method === 'PUT') {
    return updateCourse(req, res);
  } else if (req.method === 'DELETE') {
    return deleteCourse(req, res);
  } else {
    return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withAuth(handler);


/**
 * Course Detail API Route
 * GET: Get course by ID
 * PUT: Update course (admin/instructor only)
 * DELETE: Delete course (admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');

    const course = await courses.findOne({ _id: new ObjectId(id as string) });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Get lessons
    const courseLessons = await lessons
      .find({ courseId: id })
      .sort({ order: 1 })
      .toArray();

    course.lessons = courseLessons;

    // Get progress if authenticated
    if (req.user) {
      const userProgress = await progress.findOne({
        userId: req.user.userId,
        courseId: id,
      });
      course.progress = userProgress?.progress || 0;
      course.enrolled = !!userProgress;
    }

    res.json(course);
  } catch (error: any) {
    console.error('Get course error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      return res.status(404).json({ error: 'Course not found' });
    }

    // Instructors, admins, and superadmins can edit any course
    const userRole = req.user!.role;
    console.log('Update course - User role:', userRole, 'User:', req.user!.email);
    if (userRole !== 'admin' && userRole !== 'instructor' && userRole !== 'superadmin') {
      console.log('Access denied - Role not authorized:', userRole);
      return res.status(403).json({ error: 'Not authorized', role: userRole });
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
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    // Allow both admin and superadmin to delete courses
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin or Super Admin only' });
    }

    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');

    await courses.deleteOne({ _id: new ObjectId(id as string) });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


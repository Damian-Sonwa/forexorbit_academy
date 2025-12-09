/**
 * Instructor Analytics API Route
 * Returns analytics for instructor's courses
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const courses = db.collection('courses');
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');
    const users = db.collection('users');

    const instructorId = req.user!.userId;

    // Get instructor's courses
    const myCourses = await courses.find({ instructorId }).toArray();
    const courseIds = myCourses.map((c) => c._id.toString());

    // Count lessons
    const totalLessons = await lessons.countDocuments({
      courseId: { $in: courseIds },
    });

    // Get unique students enrolled in instructor's courses
    const enrollments = await progress.find({
      courseId: { $in: courseIds },
    }).toArray();

    const uniqueStudentIds = Array.from(new Set(enrollments.map((e) => e.userId)));
    const totalStudents = uniqueStudentIds.length;

    res.json({
      totalCourses: myCourses.length,
      totalLessons,
      totalStudents,
      totalEnrollments: enrollments.length,
    });
  } catch (error: any) {
    console.error('Instructor analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler, ['instructor']);





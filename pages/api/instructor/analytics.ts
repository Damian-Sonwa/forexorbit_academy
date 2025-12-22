/**
 * Instructor Analytics API Route
 * Returns comprehensive analytics for instructor's courses
 * Includes: total students, enrolled students, courses in progress, completed tasks
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const courses = db.collection('courses');
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');
    const tasks = db.collection('demoTasks');
    const submissions = db.collection('demoTaskSubmissions');

    const instructorId = req.user!.userId;

    // Get instructor's courses - handle both ObjectId and string instructorId
    const myCourses = await courses.find({
      $or: [
        { instructorId: instructorId },
        { instructorId: new ObjectId(instructorId) },
      ],
    }).toArray();

    if (myCourses.length === 0) {
      // Return zeros if no courses found
      return res.json({
        totalCourses: 0,
        totalLessons: 0,
        totalStudents: 0,
        enrolledStudents: 0,
        coursesInProgress: 0,
        completedTasks: 0,
        totalEnrollments: 0,
      });
    }

    const courseIds = myCourses.map((c) => c._id.toString());

    // Count lessons
    const totalLessons = await lessons.countDocuments({
      courseId: { $in: courseIds },
    });

    // Get all enrollments for instructor's courses
    const enrollments = await progress.find({
      courseId: { $in: courseIds },
    }).toArray();

    // Get unique students enrolled
    const uniqueStudentIds = Array.from(new Set(enrollments.map((e) => e.userId)));
    const totalStudents = uniqueStudentIds.length;
    const enrolledStudents = enrollments.length;

    // Calculate courses in progress (progress > 0 and < 100)
    const coursesInProgress = enrollments.filter(
      (e) => e.progress && e.progress > 0 && e.progress < 100
    ).length;

    // Get instructor's tasks
    const instructorTasks = await tasks.find({
      $or: [
        { instructorId: instructorId },
        { instructorId: new ObjectId(instructorId) },
      ],
    }).toArray();

    const taskIds = instructorTasks.map((t) => t._id.toString());

    // Count completed tasks (submissions with grade or reviewedAt)
    const completedTasks = await submissions.countDocuments({
      taskId: { $in: taskIds },
      $or: [
        { grade: { $ne: null } },
        { reviewedAt: { $ne: null } },
      ],
    });

    res.json({
      totalCourses: myCourses.length,
      totalLessons,
      totalStudents,
      enrolledStudents,
      coursesInProgress,
      completedTasks,
      totalEnrollments: enrollments.length,
    });
  } catch (error: any) {
    console.error('[Instructor Analytics] Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);





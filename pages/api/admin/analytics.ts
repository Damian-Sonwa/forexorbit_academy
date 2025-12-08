/**
 * Admin Analytics API Route
 * GET: Get real-time analytics (admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const db = await getDb();
    const users = db.collection('users');
    const courses = db.collection('courses');
    const progress = db.collection('progress');
    const messages = db.collection('messages');

    // Get statistics
    const [
      totalUsers,
      totalCourses,
      totalEnrollments,
      recentMessages,
    ] = await Promise.all([
      users.countDocuments(),
      courses.countDocuments(),
      progress.countDocuments(),
      messages.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    ]);

    // Get active users (users with progress in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeUsers = await progress.distinct('userId', {
      updatedAt: { $gte: sevenDaysAgo },
    });

    // Get users by role
    const usersByRole = {
      student: await users.countDocuments({ role: 'student' }),
      instructor: await users.countDocuments({ role: 'instructor' }),
      admin: await users.countDocuments({ role: 'admin' }),
    };

    // Get courses by difficulty
    const coursesByDifficulty = {
      beginner: await courses.countDocuments({ difficulty: 'beginner' }),
      intermediate: await courses.countDocuments({ difficulty: 'intermediate' }),
      advanced: await courses.countDocuments({ difficulty: 'advanced' }),
    };

    // Get enrollment trends (last 7 days)
    const enrollmentTrends = [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const count = await progress.countDocuments({
        createdAt: { $gte: date, $lt: nextDate },
      });
      
      enrollmentTrends.push({
        day: days[date.getDay()],
        enrollments: count,
      });
    }

    // Get course completion rates
    const allCoursesList = await courses.find({}).toArray();
    const courseCompletion = await Promise.all(
      allCoursesList.slice(0, 5).map(async (course) => {
        const courseId = course._id.toString();
        const enrolled = await progress.countDocuments({ courseId });
        const completed = await progress.countDocuments({
          courseId,
          progress: { $gte: 100 },
        });
        return {
          course: course.title.length > 15 ? course.title.substring(0, 15) + '...' : course.title,
          enrolled,
          completed,
        };
      })
    );

    res.json({
      totalUsers,
      totalCourses,
      totalEnrollments,
      activeUsers: activeUsers.length,
      recentMessages,
      usersByRole,
      coursesByDifficulty,
      enrollmentTrends,
      courseCompletion,
    });
  } catch (error: any) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler, ['admin', 'superadmin']);


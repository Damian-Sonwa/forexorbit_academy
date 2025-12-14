/**
 * Admin Analytics API Route
 * GET: Get real-time analytics (admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.user!.role !== 'admin') {
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

    res.json({
      totalUsers,
      totalCourses,
      totalEnrollments,
      activeUsers: activeUsers.length,
      recentMessages,
    });
  } catch (error: any) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler, ['admin']);


/**
 * Leaderboard API Route
 * GET: Get leaderboard rankings
 * Rankings based on points, course completions, quiz scores
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getLeaderboard(req: AuthRequest, res: NextApiResponse) {
  try {
    const { type = 'points', courseId } = req.query;
    const db = await getDb();
    const users = db.collection('users');
    const progress = db.collection('progress');
    const quizScores = db.collection('quizScores');
    const certificates = db.collection('certificates');

    let rankings: any[] = [];

    if (type === 'points') {
      // Leaderboard by points
      const usersList = await users
        .find({ role: 'student' }, { projection: { password: 0 } })
        .sort({ points: -1 })
        .limit(100)
        .toArray();

      rankings = usersList.map((user, index) => ({
        rank: index + 1,
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        points: user.points || 0,
        avatar: user.avatar || null,
      }));
    } else if (type === 'completions') {
      // Leaderboard by course completions
      const completedCourses = await certificates.aggregate([
        {
          $group: {
            _id: '$userId',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 100 },
      ]).toArray();

      rankings = await Promise.all(
        completedCourses.map(async (item, index) => {
          const user = await users.findOne(
            { _id: item._id },
            { projection: { name: 1, email: 1, avatar: 1 } }
          );
          return {
            rank: index + 1,
            userId: item._id.toString(),
            name: user?.name || 'Unknown',
            email: user?.email || '',
            completions: item.count,
            avatar: user?.avatar || null,
          };
        })
      );
    } else if (type === 'quizzes') {
      // Leaderboard by quiz average scores
      const quizStats = await quizScores.aggregate([
        {
          $group: {
            _id: '$userId',
            avgScore: { $avg: '$score' },
            totalQuizzes: { $sum: 1 },
          },
        },
        { $sort: { avgScore: -1 } },
        { $limit: 100 },
      ]).toArray();

      rankings = await Promise.all(
        quizStats.map(async (item, index) => {
          const user = await users.findOne(
            { _id: item._id },
            { projection: { name: 1, email: 1, avatar: 1 } }
          );
          return {
            rank: index + 1,
            userId: item._id.toString(),
            name: user?.name || 'Unknown',
            email: user?.email || '',
            avgScore: Math.round(item.avgScore),
            totalQuizzes: item.totalQuizzes,
            avatar: user?.avatar || null,
          };
        })
      );
    } else if (type === 'course' && courseId) {
      // Course-specific leaderboard
      const courseProgress = await progress
        .find({ courseId })
        .sort({ progress: -1 })
        .limit(100)
        .toArray();

      rankings = await Promise.all(
        courseProgress.map(async (item, index) => {
          const user = await users.findOne(
            { _id: new ObjectId(item.userId) },
            { projection: { name: 1, email: 1, avatar: 1 } }
          );
          return {
            rank: index + 1,
            userId: item.userId,
            name: user?.name || 'Unknown',
            email: user?.email || '',
            progress: Math.round(item.progress),
            avatar: user?.avatar || null,
          };
        })
      );
    }

    res.json(rankings);
  } catch (error: any) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(getLeaderboard);


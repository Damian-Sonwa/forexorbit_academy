import { unexpectedBody } from '@/lib/public-error';
/**
 * Leaderboard API Route
 * GET: Get leaderboard rankings
 * Rankings based on points, course completions, quiz scores
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { findByIds, objectIdsFrom } from '@/lib/batch-lookup';

async function getLeaderboard(req: AuthRequest, res: NextApiResponse) {
  try {
    const { type = 'points', courseId } = req.query;
    // Rankings are visible to every signed-in member; contact emails only to administrators.
    const showEmail = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    const emailOf = (value: unknown) => (showEmail && typeof value === 'string' ? value : undefined);
    const db = await getDb();
    const users = db.collection('users');
    const progress = db.collection('progress');
    const quizScores = db.collection('quizScores');
    const certificates = db.collection('certificates');

    let rankings: any[] = [];

    if (type === 'points') {
      // Leaderboard by points
      const usersList = await users
        .find({ role: 'student' }, { projection: { name: 1, email: 1, points: 1, avatar: 1 } })
        .sort({ points: -1 })
        .limit(100)
        .toArray();

      rankings = usersList.map((user, index) => ({
        rank: index + 1,
        userId: user._id.toString(),
        name: user.name,
        email: emailOf(user.email),
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

      // One users query for all rows; ids are matched as stored, as the per-row lookup did.
      const people = await findByIds(users, completedCourses.map((item) => item._id), { name: 1, email: 1, avatar: 1 });
      rankings = completedCourses.map((item, index) => {
          const user = people.get(String(item._id));
          return {
            rank: index + 1,
            userId: item._id.toString(),
            name: user?.name || 'Unknown',
            email: emailOf(user?.email),
            completions: item.count,
            avatar: user?.avatar || null,
          };
        });
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

      const people = await findByIds(users, quizStats.map((item) => item._id), { name: 1, email: 1, avatar: 1 });
      rankings = quizStats.map((item, index) => {
          const user = people.get(String(item._id));
          return {
            rank: index + 1,
            userId: item._id.toString(),
            name: user?.name || 'Unknown',
            email: emailOf(user?.email),
            avgScore: Math.round(item.avgScore),
            totalQuizzes: item.totalQuizzes,
            avatar: user?.avatar || null,
          };
        });
    } else if (type === 'course' && courseId) {
      // Course-specific leaderboard
      const courseProgress = await progress
        .find({ courseId })
        .sort({ progress: -1 })
        .limit(100)
        .toArray();

      const people = await findByIds(users, objectIdsFrom(courseProgress.map((item) => item.userId)), { name: 1, email: 1, avatar: 1 });
      rankings = courseProgress.map((item, index) => {
          const user = people.get(String(item.userId));
          return {
            rank: index + 1,
            userId: item.userId,
            name: user?.name || 'Unknown',
            email: emailOf(user?.email),
            progress: Math.round(item.progress),
            avatar: user?.avatar || null,
          };
        });
    }

    res.json(rankings);
  } catch (error: any) {
    console.error('Get leaderboard error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(getLeaderboard);


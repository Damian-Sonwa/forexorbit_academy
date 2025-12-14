/**
 * Progress API Route
 * GET: Get user progress for all courses
 * POST: Update lesson progress
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function getProgress(req: AuthRequest, res: NextApiResponse) {
  try {
    const userId = req.user!.userId;
    const db = await getDb();
    const progress = db.collection('progress');
    const courses = db.collection('courses');
    const lessons = db.collection('lessons');
    const quizScores = db.collection('quizScores');

    const userProgress = await progress.find({ userId }).toArray();

    // Enrich with course details, lesson info, and quiz scores
    const enrichedProgress = await Promise.all(
      userProgress.map(async (p) => {
        const course = await courses.findOne({ _id: p.courseId });
        const courseLessons = await lessons.find({ courseId: p.courseId }).toArray();
        const userQuizScores = await quizScores.find({ userId, courseId: p.courseId }).toArray();

        return {
          ...p,
          course: course ? {
            id: course._id.toString(),
            title: course.title,
            thumbnail: course.thumbnail,
            difficulty: course.difficulty,
            category: course.category,
          } : null,
          totalLessons: courseLessons.length,
          completedLessonsCount: p.completedLessons?.length || 0,
          quizScores: userQuizScores.map(q => ({
            lessonId: q.lessonId,
            score: q.score,
            totalQuestions: q.totalQuestions,
            percentage: q.totalQuestions > 0 ? Math.round((q.score / q.totalQuestions) * 100) : 0,
          })),
        };
      })
    );

    res.json(enrichedProgress);
  } catch (error: any) {
    console.error('Get progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateProgress(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId, lessonId } = req.body;
    const userId = req.user!.userId;

    if (!courseId || !lessonId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const progress = db.collection('progress');
    const lessons = db.collection('lessons');

    // Get course progress
    let courseProgress = await progress.findOne({ userId, courseId });

    const completedLessons = courseProgress?.completedLessons || [];
    if (!completedLessons.includes(lessonId)) {
      completedLessons.push(lessonId);
    }

    // Calculate overall progress
    const courseLessons = await lessons.find({ courseId }).toArray();
    const progressPercent = (completedLessons.length / courseLessons.length) * 100;

    if (courseProgress) {
      // Update existing
      await progress.updateOne(
        { userId, courseId },
        {
          $set: {
            completedLessons,
            progress: progressPercent,
            updatedAt: new Date(),
          },
        }
      );
    } else {
      // Create new
      await progress.insertOne({
        userId,
        courseId,
        completedLessons,
        progress: progressPercent,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    res.json({ success: true, progress: progressPercent });
  } catch (error: any) {
    console.error('Update progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getProgress(req, res);
  } else if (req.method === 'POST') {
    return updateProgress(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler, ['student']);


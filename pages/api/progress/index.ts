/**
 * Progress API Route
 * GET: Get user progress for all courses
 * POST: Update lesson progress
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { updateLearningLevelIfEligible } from '@/lib/learning-level';

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
        // Convert courseId to ObjectId if it's a string
        let courseIdObj;
        const courseIdStr = p.courseId?.toString() || '';
        
        try {
          // Try to convert to ObjectId if it's a string
          if (typeof p.courseId === 'string') {
            courseIdObj = new ObjectId(p.courseId);
          } else if (p.courseId instanceof ObjectId) {
            courseIdObj = p.courseId;
          } else {
            // If it's already an ObjectId or other format, use as is
            courseIdObj = p.courseId;
          }
        } catch (err) {
          console.error(`Invalid courseId format: ${p.courseId}`, err);
          // Try to find course by string match as fallback
          courseIdObj = courseIdStr;
        }
        
        // Try to find course by ObjectId first
        let course = await courses.findOne({ _id: courseIdObj });
        
        // If not found and courseId is a string, try finding by string comparison
        if (!course && courseIdStr) {
          // Try to find by converting all courses and matching
          const allCourses = await courses.find({}).toArray();
          course = allCourses.find((c) => c._id.toString() === courseIdStr) || null;
        }
        
        // Log if course is still not found for debugging
        if (!course) {
          console.warn(`Course not found for courseId: ${courseIdStr} (type: ${typeof p.courseId})`);
        }
        
        const courseLessons = await lessons.find({ courseId: courseIdStr }).toArray();
        const userQuizScores = await quizScores.find({ userId, courseId: courseIdStr }).toArray();

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

    // Check if user should advance to next learning level
    // This runs asynchronously to not block the response
    updateLearningLevelIfEligible(userId).catch((error) => {
      console.error('Error updating learning level:', error);
    });

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

// Allow all authenticated users to access their own progress
export default withAuth(handler);


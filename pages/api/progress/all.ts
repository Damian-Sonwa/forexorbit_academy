/**
 * Progress API Route - All Users (Instructor/Admin)
 * GET: Get progress for all students (instructor sees their courses, admin sees all)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getAllProgress(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const progress = db.collection('progress');
    const courses = db.collection('courses');
    const users = db.collection('users');
    const lessons = db.collection('lessons');
    const quizScores = db.collection('quizScores');

    const { courseId, userId, difficulty } = req.query;

    let query: any = {};

    // Instructor: only see students in their courses
    if (req.user!.role === 'instructor') {
      const instructorCourses = await courses.find({ instructorId: req.user!.userId }).toArray();
      const courseIds = instructorCourses.map(c => c._id?.toString() || c.id);
      if (courseIds.length > 0) {
        query.courseId = { $in: courseIds };
      } else {
        // No courses, return empty
        return res.json([]);
      }
    }

    // Admin: can filter by course, user, or difficulty
    if (req.user!.role === 'admin') {
      if (courseId) {
        query.courseId = courseId;
      }
      if (userId) {
        query.userId = userId;
      }
      if (difficulty) {
        // Get course IDs with this difficulty
        const coursesWithDifficulty = await courses.find({ difficulty }).toArray();
        const courseIds = coursesWithDifficulty.map(c => c._id.toString());
        query.courseId = { $in: courseIds };
      }
    }

    const allProgress = await progress.find(query).toArray();

    // Enrich with course, user, and lesson details
    const enrichedProgress = await Promise.all(
      allProgress.map(async (p) => {
        let course = null;
        let user = null;
        
        try {
          course = await courses.findOne({ _id: new ObjectId(p.courseId) });
        } catch (e) {
          // Try finding by string ID
          course = await courses.findOne({ _id: p.courseId });
        }
        
        try {
          user = await users.findOne({ _id: new ObjectId(p.userId) });
        } catch (e) {
          // Try finding by string ID
          user = await users.findOne({ _id: p.userId });
        }
        
        const courseLessons = await lessons.find({ courseId: p.courseId }).toArray();
        const userQuizScores = await quizScores.find({ userId: p.userId, courseId: p.courseId }).toArray();

        return {
          ...p,
          course: course ? {
            id: course._id.toString(),
            title: course.title,
            difficulty: course.difficulty,
            category: course.category,
          } : null,
          user: user ? {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
          } : null,
          totalLessons: courseLessons.length,
          completedLessonsCount: p.completedLessons?.length || 0,
          quizScores: userQuizScores.map(q => ({
            lessonId: q.lessonId,
            score: q.score,
            totalQuestions: q.totalQuestions,
          })),
        };
      })
    );

    res.json(enrichedProgress);
  } catch (error: any) {
    console.error('Get all progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(getAllProgress, ['instructor', 'admin']);


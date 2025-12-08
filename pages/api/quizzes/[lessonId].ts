/**
 * Quiz API Route
 * GET: Get quiz for a lesson
 * POST: Submit quiz and get results
 * PUT: Create/Update quiz (admin/instructor only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

async function getQuiz(req: AuthRequest, res: NextApiResponse) {
  try {
    const { lessonId } = req.query;
    const db = await getDb();
    const quizzes = db.collection('quizzes');

    const quiz = await quizzes.findOne({ lessonId });
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Don't send correct answers if not admin/instructor
    if (req.user!.role !== 'admin' && req.user!.role !== 'instructor') {
      quiz.questions = quiz.questions.map((q: any) => ({
        ...q,
        correctAnswer: undefined,
      }));
    }

    res.json(quiz);
  } catch (error: any) {
    console.error('Get quiz error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function submitQuiz(req: AuthRequest, res: NextApiResponse) {
  try {
    const { lessonId } = req.query;
    const { answers } = req.body;
    const userId = req.user!.userId;

    const db = await getDb();
    const quizzes = db.collection('quizzes');
    const progress = db.collection('progress');
    const quizScores = db.collection('quizScores');

    // Get quiz
    const quiz = await quizzes.findOne({ lessonId });
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Grade quiz
    let correct = 0;
    const results = quiz.questions.map((question: any, index: number) => {
      const userAnswer = answers[index];
      const isCorrect = userAnswer === question.correctAnswer;
      if (isCorrect) correct++;
      return {
        question: question.question,
        userAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
      };
    });

    const score = (correct / quiz.questions.length) * 100;

    // Save score
    await quizScores.insertOne({
      userId,
      lessonId,
      courseId: quiz.courseId,
      score,
      answers,
      createdAt: new Date(),
    });

    // Update course progress
    const courseProgress = await progress.findOne({
      userId,
      courseId: quiz.courseId,
    });

    if (courseProgress) {
      // Mark lesson as completed if not already
      const completedLessons = courseProgress.completedLessons || [];
      if (!completedLessons.includes(lessonId as string)) {
        completedLessons.push(lessonId as string);
      }

      // Calculate overall progress
      const lessons = await db.collection('lessons').find({ courseId: quiz.courseId }).toArray();
      const progressPercent = (completedLessons.length / lessons.length) * 100;

      await progress.updateOne(
        { userId, courseId: quiz.courseId },
        {
          $set: {
            completedLessons,
            progress: progressPercent,
            updatedAt: new Date(),
          },
        }
      );
    }

    res.json({
      score,
      correct,
      total: quiz.questions.length,
      results,
    });
  } catch (error: any) {
    console.error('Submit quiz error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createQuiz(req: AuthRequest, res: NextApiResponse) {
  try {
    const { lessonId, courseId, questions } = req.body;

    if (!lessonId || !courseId || !questions) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const quizzes = db.collection('quizzes');

    // Check if quiz exists
    const existing = await quizzes.findOne({ lessonId });
    if (existing) {
      // Update
      await quizzes.updateOne(
        { lessonId },
        { $set: { questions, updatedAt: new Date() } }
      );
      res.json({ success: true, id: existing._id.toString() });
    } else {
      // Create
      const result = await quizzes.insertOne({
        lessonId,
        courseId,
        questions,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      res.status(201).json({ success: true, id: result.insertedId.toString() });
    }
  } catch (error: any) {
    console.error('Create quiz error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getQuiz(req, res);
  } else if (req.method === 'POST') {
    return submitQuiz(req, res);
  } else if (req.method === 'PUT') {
    return createQuiz(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);



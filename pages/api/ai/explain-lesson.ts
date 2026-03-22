/**
 * AI API: Explain Lesson
 * Provides AI-powered explanations for lessons
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { explainLesson, isAIConfigured } from '@/lib/ai';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ message: 'AI service is not configured' });
  }

  try {
    const { lessonTitle, lessonContent, userLevel } = req.body;

    if (!lessonTitle || !lessonContent) {
      return res.status(400).json({ message: 'lessonTitle and lessonContent are required' });
    }

    const explanation = await explainLesson(
      lessonTitle,
      lessonContent,
      userLevel,
      req.user!.userId
    );

    res.json({ explanation });
  } catch (error: unknown) {
    console.error('AI explain lesson error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler, ['student', 'instructor', 'admin', 'superadmin']);


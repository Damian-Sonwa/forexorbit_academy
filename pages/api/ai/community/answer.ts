/**
 * AI API: Community Answer
 * Provides AI-powered answers to questions in community chat (on-demand only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { answerQuestion, isAIConfigured } from '@/lib/ai';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ message: 'AI service is not configured' });
  }

  try {
    const { question, userLevel } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ message: 'question is required' });
    }

    const answer = await answerQuestion(question, userLevel, req.user!.userId);

    res.json({ answer });
  } catch (error: unknown) {
    console.error('AI community answer error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler, ['student', 'instructor', 'admin', 'superadmin']);


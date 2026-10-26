/**
 * AI API: Community Answer
 * Provides AI-powered answers to questions in community chat (on-demand only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { answerQuestion, isAIConfigured } from '@/lib/ai';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI service is not configured' });
  }

  try {
    const { question, userLevel } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'question is required' });
    }

    const answer = await answerQuestion(question, userLevel, req.user!.userId);

    res.json({ answer });
  } catch (error: unknown) {
    console.error('AI community answer error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get AI answer';
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(handler, ['student', 'instructor', 'admin', 'superadmin']);


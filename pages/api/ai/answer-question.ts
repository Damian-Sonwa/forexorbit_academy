/**
 * AI API: Answer Question
 * Provides AI-powered answers to general questions
 * 
 * CORS: Must allow requests from Vercel frontend
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { answerQuestion, isAIConfigured } from '@/lib/ai';

// Allowed frontend origins - explicitly list all Vercel domains
const ALLOWED_ORIGINS = [
  'https://forexorbit-academy.vercel.app',
  'https://forexorbit-academy11.vercel.app',
  'https://forexorbit-academy001.vercel.app',
  // Allow any Vercel preview URLs
  ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
];

// CORS headers helper
function setCorsHeaders(res: NextApiResponse, origin?: string) {
  const isAllowedOrigin = origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    origin.includes('forexorbit-academy.vercel.app') ||
    origin.includes('.vercel.app')
  );
  
  if (isAllowedOrigin && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin && origin.includes('vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://forexorbit-academy.vercel.app');
  }
  
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  // Get origin from request headers
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, origin);
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    setCorsHeaders(res, origin);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set CORS headers for actual requests
  setCorsHeaders(res, origin);

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
    console.error('AI answer question error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get AI answer';
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(handler, ['student', 'instructor', 'admin', 'superadmin']);


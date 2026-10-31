import { unexpectedBody } from '@/lib/public-error';
/**
 * AI API: Answer Question
 * Provides AI-powered answers to general questions
 * 
 * CORS: exact trusted origin only (lib/request-guard.js)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { CSRF_HEADER, corsOrigin } from '@/lib/request-guard';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { answerQuestion, isAIConfigured } from '@/lib/ai';

// CORS: only the exact trusted origin (lib/request-guard.js). Pages and API share one origin,
// so the browser normally sends no cross-origin request here at all.
function setCorsHeaders(res: NextApiResponse, origin?: string) {
  const allowed = corsOrigin(origin);
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${CSRF_HEADER}`);
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

async function handler(req: AuthRequest, res: NextApiResponse): Promise<void> {
  // Get origin from request headers
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  
  // Set CORS headers for all responses (including errors)
  setCorsHeaders(res, origin);

  if (!isAIConfigured()) {
    res.status(503).json({ error: 'AI service is not configured' });
    return;
  }

  try {
    const { question, userLevel } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    const answer = await answerQuestion(question, userLevel, req.user!.userId);

    res.json({ answer });
  } catch (error: unknown) {
    console.error('AI answer question error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

// Wrapper to handle CORS before auth
export default async function(req: NextApiRequest, res: NextApiResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  
  // Handle preflight OPTIONS request - must be before withAuth
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, origin);
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    setCorsHeaders(res, origin);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Set CORS headers before calling withAuth (so 401 responses include CORS headers)
  setCorsHeaders(res, origin);

  // Now call withAuth - it will handle authentication
  return withAuth(handler, ['student', 'instructor', 'admin', 'superadmin'])(req as AuthRequest, res);
}

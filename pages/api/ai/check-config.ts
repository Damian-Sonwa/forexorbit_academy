/**
 * AI Config Check API
 * Public endpoint to check if AI is configured (for frontend display)
 * Does NOT expose API keys or sensitive information
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAIConfigured } from '@/lib/ai';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CRITICAL: Only allow on server-side
  if (typeof window !== 'undefined') {
    return res.status(403).json({ error: 'This endpoint is only available on the backend' });
  }

  try {
    const configured = isAIConfigured();
    res.json({ 
      configured,
      // Do NOT expose any API key information
    });
  } catch (error: unknown) {
    console.error('[AI Config Check] Error:', error);
    res.json({ configured: false });
  }
}


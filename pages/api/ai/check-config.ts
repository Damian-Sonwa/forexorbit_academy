/**
 * AI Config Check API
 * Public endpoint to check if AI is configured (for frontend display)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAIConfigured } from '@/lib/ai';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.json({ configured: isAIConfigured() });
}


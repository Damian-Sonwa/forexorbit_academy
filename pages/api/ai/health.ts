/**
 * AI Health Check Endpoint
 * Validates AI configuration without exposing sensitive information
 * Only accessible on backend (Render)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAIConfigured } from '@/lib/ai';
import { unexpectedBody } from '@/lib/public-error';

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
    res.json({ configured });
  } catch (error: unknown) {
    res.status(500).json({ ...unexpectedBody('ai-health', error), configured: false });
  }
}


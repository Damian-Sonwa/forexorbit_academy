/**
 * AI Config Check API
 * Public endpoint to check if AI is configured (for frontend display)
 * Does NOT expose API keys or sensitive information
 * 
 * NOTE: This endpoint should be called on Render backend, not Vercel
 * If called on Vercel, it will return configured: false (Vercel doesn't have AI_API_KEY)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAIConfigured } from '@/lib/ai';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if AI is configured (only works on Render backend where AI_API_KEY exists)
    const configured = isAIConfigured();
    
    // Log for debugging (only on server-side)
    if (typeof window === 'undefined') {
      console.log('[AI Config Check] AI configured:', configured, 'Environment:', process.env.NODE_ENV);
    }
    
    res.json({ 
      configured,
      // Do NOT expose any API key information
    });
  } catch (error: unknown) {
    console.error('[AI Config Check] Error:', error instanceof Error ? error.message : 'Unknown error');
    res.json({ configured: false });
  }
}


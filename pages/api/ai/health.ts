/**
 * AI Health Check Endpoint
 * Validates AI configuration without exposing sensitive information
 * Only accessible on backend (Render)
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
    const hasApiKey = !!process.env.AI_API_KEY;
    const apiKeyFormat = hasApiKey && process.env.AI_API_KEY?.startsWith('sk-');
    const model = process.env.AI_MODEL || 'gpt-3.5-turbo';
    const maxTokens = parseInt(process.env.AI_MAX_TOKENS || '500', 10);
    const temperature = parseFloat(process.env.AI_TEMPERATURE || '0.7');

    // Return configuration status without exposing the actual key
    res.json({
      configured,
      hasApiKey,
      apiKeyFormatValid: apiKeyFormat,
      model,
      maxTokens,
      temperature,
      environment: process.env.NODE_ENV || 'development',
      backend: true, // Confirms this is running on backend
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI Health] Error:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to check AI configuration',
      configured: false,
    });
  }
}


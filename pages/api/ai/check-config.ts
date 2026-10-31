/**
 * AI Config Check API
 * Public endpoint to check if AI is configured (for frontend display)
 * Does NOT expose API keys or sensitive information
 * 
 * NOTE: This endpoint should be called on Render backend, not Vercel
 * If called on Vercel, it will return configured: false (Vercel doesn't have AI_API_KEY)
 * 
 * CORS: exact trusted origin only (lib/request-guard.js)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { CSRF_HEADER, corsOrigin } from '@/lib/request-guard';
import { isAIConfigured } from '@/lib/ai';

// CORS: only the exact trusted origin (lib/request-guard.js). Pages and API share one origin,
// so the browser normally sends no cross-origin request here at all.
function setCorsHeaders(res: NextApiResponse, origin?: string) {
  const allowed = corsOrigin(origin);
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${CSRF_HEADER}`);
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get origin from request headers (browser automatically sends Origin header for CORS requests)
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  
  // Handle preflight OPTIONS request - MUST return 200 with CORS headers
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, origin);
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    setCorsHeaders(res, origin);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Set CORS headers for all actual requests (GET) - must be set before any response
  setCorsHeaders(res, origin);

  try {
    // Check if AI is configured (only works on Render backend where AI_API_KEY exists)
    const configured = isAIConfigured();
    
    // Log for debugging (only on server-side)
    res.json({ 
      configured,
      // Do NOT expose any API key information
    });
  } catch (error: unknown) {
    console.error('[AI Config Check] Error');
    res.json({ configured: false });
  }
}


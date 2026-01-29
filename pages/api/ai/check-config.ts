/**
 * AI Config Check API
 * Public endpoint to check if AI is configured (for frontend display)
 * Does NOT expose API keys or sensitive information
 * 
 * NOTE: This endpoint should be called on Render backend, not Vercel
 * If called on Vercel, it will return configured: false (Vercel doesn't have AI_API_KEY)
 * 
 * CORS: Must allow requests from Vercel frontend
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAIConfigured } from '@/lib/ai';

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
  // Check if origin is in allowed list
  const isAllowedOrigin = origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    origin.includes('forexorbit-academy.vercel.app') ||
    origin.includes('.vercel.app')
  );
  
  // CRITICAL: Do NOT use wildcard (*) when credentials are enabled
  // Must explicitly set the origin that made the request
  if (isAllowedOrigin && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin && origin.includes('vercel.app')) {
    // Fallback: allow any Vercel domain (for preview deployments)
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Default to main Vercel domain if origin doesn't match
    res.setHeader('Access-Control-Allow-Origin', 'https://forexorbit-academy.vercel.app');
  }
  
  // Set required CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get origin from request headers (browser automatically sends Origin header for CORS requests)
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
  
  // Handle preflight OPTIONS request - MUST return 200 with CORS headers
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, origin);
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    setCorsHeaders(res, origin);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set CORS headers for all actual requests (GET) - must be set before any response
  setCorsHeaders(res, origin);

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


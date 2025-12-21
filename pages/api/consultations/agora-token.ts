/**
 * API Route: Generate Agora Token for Consultation Calls
 * Generates temporary token for voice/video calls
 * GET /api/consultations/agora-token?channel=<sessionId>
 * 
 * SECURITY: This endpoint MUST run ONLY on Render backend
 * - AGORA_APP_CERTIFICATE must be set in Render environment variables only
 * - This endpoint should NOT be deployed to Vercel (or will return error)
 * - Frontend should call: https://forexorbit-academy.onrender.com/api/consultations/agora-token
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';

// Agora App ID - check both NEXT_PUBLIC_AGORA_APP_ID (Vercel) and AGORA_APP_ID (Render)
// App Certificate - MUST be set on Render backend only (NOT in Vercel)
const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

// Allowed frontend origin
const ALLOWED_ORIGIN = 'https://forexorbit-academy.vercel.app';

// CORS headers helper
function setCorsHeaders(res: NextApiResponse, origin?: string) {
  // Check if origin is allowed (production only - NO localhost)
  const isAllowedOrigin = origin === ALLOWED_ORIGIN || 
                         origin?.includes('forexorbit-academy.vercel.app');
  
  if (isAllowedOrigin && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Default to allowed origin if no origin header or not matching
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, req.headers.origin);
    return res.status(200).end();
  }

  // Set CORS headers for all requests
  setCorsHeaders(res, req.headers.origin);

  // CRITICAL: This endpoint must run on Render backend only
  // AGORA_APP_CERTIFICATE should NEVER be set in Vercel environment
  if (!AGORA_APP_CERTIFICATE) {
    console.error('AGORA_APP_CERTIFICATE not configured. This endpoint must run on Render backend.');
    return res.status(500).json({ 
      error: 'Agora token service unavailable. Please contact support.',
    });
  }

  // Support both GET and POST for compatibility
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get channel from query (GET) or body (POST)
    const channel = req.method === 'GET' ? req.query.channel : req.body.sessionId;
    
    if (!channel || typeof channel !== 'string') {
      return res.status(400).json({ error: 'Channel is required' });
    }

    // Validate Agora credentials
    if (!AGORA_APP_ID) {
      console.error('Agora App ID not configured. Set NEXT_PUBLIC_AGORA_APP_ID or AGORA_APP_ID environment variable.');
      return res.status(500).json({ 
        error: 'Agora token service unavailable. Please contact support.',
      });
    }

    // AGORA_APP_CERTIFICATE check is already done above, but double-check for safety
    if (!AGORA_APP_CERTIFICATE) {
      console.error('Agora App Certificate not configured. This endpoint must run on Render backend with AGORA_APP_CERTIFICATE set.');
      return res.status(503).json({ 
        error: 'Agora token service is only available on Render backend. Please contact support.',
      });
    }

    // Channel name for this consultation session
    // If channel doesn't start with 'consultation_', add it
    const channelName = channel.startsWith('consultation_') ? channel : `consultation_${channel}`;
    
    // Get UID from query or default to 0 (let Agora assign automatically)
    const uid = req.method === 'GET' && req.query.uid 
      ? parseInt(req.query.uid as string, 10) 
      : 0;
    
    // Token expiration time (1 hour = 3600 seconds)
    const expireTime = 3600;
    const currentTime = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTime + expireTime;
    
    // Build token with publisher role (can publish and subscribe)
    // Using the correct format: privilegeExpireTime instead of expirationTimeInSeconds
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      privilegeExpireTime
    );

    console.log('Agora token generated successfully:', {
      channel: channelName,
      uid,
      expireTime,
      privilegeExpireTime,
      tokenLength: token.length,
    });

    // Return token (and additional info for frontend compatibility)
    return res.status(200).json({
      token,
      appId: AGORA_APP_ID,
      channel: channelName,
      uid: uid,
    });
  } catch (error: any) {
    console.error('Error generating Agora token:', error);
    // Don't expose internal errors to frontend - show generic message
    return res.status(500).json({ 
      error: 'Agora token service unavailable. Please contact support.',
    });
  }
}


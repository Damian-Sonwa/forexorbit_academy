/**
 * API Route: Generate Agora Token for Consultation Calls
 * Generates temporary token for voice/video calls
 * GET /api/consultations/agora-token?channel=<sessionId>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';

// Agora App ID - check both NEXT_PUBLIC_AGORA_APP_ID (Vercel) and AGORA_APP_ID (Render)
// App Certificate - MUST be set on Render backend only
const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // TEMPORARY: Add logging to debug environment variables
  console.log('=== AGORA TOKEN API DEBUG ===');
  console.log('AGORA_APP_ID:', !!AGORA_APP_ID, AGORA_APP_ID ? AGORA_APP_ID.substring(0, 8) + '...' : 'MISSING');
  console.log('AGORA_APP_CERTIFICATE:', !!AGORA_APP_CERTIFICATE, AGORA_APP_CERTIFICATE ? 'SET (hidden)' : 'MISSING');
  console.log('process.env.NEXT_PUBLIC_AGORA_APP_ID:', !!process.env.NEXT_PUBLIC_AGORA_APP_ID);
  console.log('process.env.AGORA_APP_ID:', !!process.env.AGORA_APP_ID);
  console.log('process.env.AGORA_APP_CERTIFICATE:', !!process.env.AGORA_APP_CERTIFICATE);
  console.log('================================');

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

    if (!AGORA_APP_CERTIFICATE) {
      console.error('Agora App Certificate not configured on server. Set AGORA_APP_CERTIFICATE environment variable on Render.');
      return res.status(500).json({ 
        error: 'Agora token service unavailable. Please contact support.',
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


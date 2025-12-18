/**
 * API Route: Generate Agora Token for Consultation Calls
 * Generates temporary token for voice/video calls
 * GET /api/consultations/agora-token?channel=<sessionId>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';

// Agora App ID from frontend env var (accessible in Next.js API routes)
// App Certificate from server env var (should be set on Vercel/Render)
const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      console.error('Agora credentials not configured:', {
        hasAppId: !!AGORA_APP_ID,
        hasCertificate: !!AGORA_APP_CERTIFICATE,
      });
      return res.status(500).json({ 
        error: 'Agora service not configured. Please set NEXT_PUBLIC_AGORA_APP_ID and AGORA_APP_CERTIFICATE environment variables.' 
      });
    }

    // Channel name for this consultation session
    // If channel doesn't start with 'consultation_', add it
    const channelName = channel.startsWith('consultation_') ? channel : `consultation_${channel}`;
    
    // Use UID 0 to let Agora assign automatically (recommended)
    const uid = 0;
    
    // Token expiration time (1 hour as per requirements)
    const expirationTimeInSeconds = Math.floor(Date.now() / 1000) + 3600;
    
    // Build token with publisher role (can publish and subscribe)
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expirationTimeInSeconds
    );

    console.log('Agora token generated for channel:', channelName);

    return res.status(200).json({
      token,
      appId: AGORA_APP_ID,
      channel: channelName,
      uid: uid,
    });
  } catch (error: any) {
    console.error('Error generating Agora token:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to generate token',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}


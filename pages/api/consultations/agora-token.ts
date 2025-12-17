/**
 * API Route: Generate Agora Token for Consultation Calls
 * Generates temporary token for voice/video calls
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';

// Agora App ID and App Certificate from environment variables
const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sessionId, uid } = req.body;

    if (!sessionId || !uid) {
      return res.status(400).json({ error: 'sessionId and uid are required' });
    }

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      console.error('Agora credentials not configured');
      return res.status(500).json({ error: 'Agora service not configured' });
    }

    // Channel name for this consultation session
    const channelName = `consultation_${sessionId}`;
    
    // User ID (can be string or number)
    const userId = typeof uid === 'string' ? parseInt(uid, 10) || 0 : uid;
    
    // Token expiration time (24 hours)
    const expirationTimeInSeconds = Math.floor(Date.now() / 1000) + 3600 * 24;
    
    // Build token with publisher role (can publish and subscribe)
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      userId,
      RtcRole.PUBLISHER,
      expirationTimeInSeconds
    );

    return res.status(200).json({
      token,
      appId: AGORA_APP_ID,
      channel: channelName,
      uid: userId,
    });
  } catch (error: any) {
    console.error('Error generating Agora token:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate token' });
  }
}


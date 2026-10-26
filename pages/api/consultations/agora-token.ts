/**
 * API Route: Generate Agora Token for Consultation Calls
 * Generates temporary token for voice/video calls
 * GET /api/consultations/agora-token?channel=<sessionId>
 * 
 * SECURITY: The app certificate stays in the server environment.
 * The browser calls this route on NEXT_PUBLIC_API_BASE_URL, or on the page
 * origin when that variable is unset.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { decideAccountAccess, decideConsultationPublisherToken, consultationLookupId, consultationPublisherResponse } from '@/lib/account-access';

// Agora App ID - check both NEXT_PUBLIC_AGORA_APP_ID (Vercel) and AGORA_APP_ID (Render)
// App Certificate - MUST be set on Render backend only (NOT in Vercel)
const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // Add preflight cache control
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

async function issuePublisherToken(req: AuthRequest, res: NextApiResponse) {
  const supplied = req.method === 'GET' ? req.query.channel : req.body?.sessionId;
  const lookupId = consultationLookupId(typeof supplied === 'string' ? supplied : '');
  if (!lookupId) {
    return res.status(400).json({ error: 'Invalid session' });
  }

  try {
    const db = await getDb();
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { email: 1, role: 1, status: 1 } }
    );
    const account = decideAccountAccess({ userId: req.user!.userId, record });
    const session = await db.collection('consultationSessions').findOne(
      { _id: new ObjectId(lookupId) },
      { projection: { studentId: 1, expertId: 1, status: 1 } }
    );
    const decision = decideConsultationPublisherToken({
      member: account.ok ? { userId: account.user.userId, role: account.user.role } : null,
      session: session ? {
        _id: session._id,
        studentId: session.studentId,
        expertId: session.expertId,
        status: typeof session.status === 'string' ? session.status : '',
      } : null,
    });
    const issued = consultationPublisherResponse({
      decision,
      appId: AGORA_APP_ID,
      nowSeconds: Math.floor(Date.now() / 1000),
      issue: decision.ok ? ({ channel, account: accountName, privilegeExpireTime }) => RtcTokenBuilder.buildTokenWithAccount(
        AGORA_APP_ID,
        AGORA_APP_CERTIFICATE,
        channel,
        accountName,
        RtcRole.PUBLISHER,
        privilegeExpireTime
      ) : undefined,
    });
    if (!issued.ok) {
      return res.status(issued.status).json({ error: issued.error });
    }
    return res.status(200).json(issued.body);
  } catch {
    console.error(JSON.stringify({ event: 'agoraToken', result: 'failed' }));
    return res.status(500).json({ error: 'Unable to start the call' });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const origin = req.headers.origin as string | undefined;

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, origin);
    return res.status(200).end();
  }

  setCorsHeaders(res, origin);

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return withAuth(issuePublisherToken)(req as AuthRequest, res);
}


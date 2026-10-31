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
import { unexpectedBody } from '@/lib/public-error';
import { CSRF_HEADER, corsOrigin } from '@/lib/request-guard';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { ObjectId } from 'mongodb';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { decideAccountAccess, decideConsultationPublisherToken, consultationLookupId, consultationPublisherResponse } from '@/lib/account-access';

// Agora App ID - check both NEXT_PUBLIC_AGORA_APP_ID (Vercel) and AGORA_APP_ID (Render)
// App Certificate - MUST be set on Render backend only (NOT in Vercel)
const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

// CORS: only the exact trusted origin (lib/request-guard.js). Pages and API share one origin,
// so the browser normally sends no cross-origin request here at all.
function setCorsHeaders(res: NextApiResponse, origin?: string) {
  const allowed = corsOrigin(origin);
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${CSRF_HEADER}`);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
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
  } catch (error) {
    return res.status(500).json(unexpectedBody('agora-token', error));
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


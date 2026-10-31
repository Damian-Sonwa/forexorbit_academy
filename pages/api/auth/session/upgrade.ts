/**
 * TEMPORARY (Phase 4.5 rollout only; delete with lib/legacy-bearer.js after the window).
 *
 * POST /api/auth/session/upgrade  with  Authorization: Bearer <pre-4.5 token>
 *
 * Exchanges a still-valid pre-4.5 token (signature, expiry, sessionGeneration binding and an active
 * account) for a cookie session. Closed (410) unless AUTH_LEGACY_BEARER_UNTIL opens the window.
 * Origin and CSRF-header checks apply as for every state-changing request. The token is never
 * logged or returned. The client deletes its stored copy whatever the answer.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { unexpectedBody } from '@/lib/public-error';
import { decideAccountAccess } from '@/lib/account-access';
import { decideSessionBinding, extractToken, verifyToken } from '@/lib/jwt';
import { legacyBearerWindow } from '@/lib/legacy-bearer';
import { checkRequestOrigin, startSession } from '@/lib/session-auth';
import { LOGIN_RULES, createAuthLimiter, sendRefusal } from '@/lib/auth-rate-limit';
import { clientAddress } from '@/lib/client-ip';

const upgradeLimiter = createAuthLimiter(LOGIN_RULES);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const origin = checkRequestOrigin(req);
  if (!origin.ok) return res.status(origin.status).json({ error: origin.error, code: origin.code });

  const window = legacyBearerWindow();
  if (!window.open) {
    return res.status(410).json({ error: 'Please sign in again.', code: 'legacy_upgrade_closed' });
  }
  const secret = process.env.JWT_SECRET?.trim();
  const token = extractToken(typeof req.headers.authorization === 'string' ? req.headers.authorization : null);
  if (!secret || !token) {
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  try {
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Please sign in again.' });
    }
    if (!payload?.userId || !ObjectId.isValid(payload.userId)) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }
    const limit = await upgradeLimiter.consume({ ip: clientAddress(req), email: `upgrade:${payload.userId}`, getDb });
    if (!limit.allowed) return sendRefusal(res, limit);

    const db = await getDb();
    const record = await db.collection('users').findOne(
      { _id: new ObjectId(payload.userId) },
      { projection: { email: 1, role: 1, status: 1, sessionGeneration: 1 } }
    );
    const account = decideAccountAccess({ userId: payload.userId, record });
    if (!account.ok) return res.status(401).json({ error: 'Please sign in again.' });
    const binding = decideSessionBinding({
      userId: account.user.userId,
      binding: payload.sv,
      generation: record?.sessionGeneration,
      key: secret,
    });
    if (!binding.ok) return res.status(401).json({ error: 'Please sign in again.' });

    await startSession(res, db, { userId: account.user.userId, sessionGeneration: record?.sessionGeneration });
    console.info(JSON.stringify({ event: 'legacy_session_upgraded' }));
    return res.status(200).json({ upgraded: true });
  } catch (error: unknown) {
    return res.status(500).json(unexpectedBody('session-upgrade', error));
  }
}

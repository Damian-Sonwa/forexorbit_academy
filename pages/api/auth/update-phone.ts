/**
 * Update phone for password reset (authenticated)
 * PATCH /api/auth/update-phone  { phone }
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { parseToE164 } from '@/lib/phone';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const parsed = parseToE164(phone);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    const db = await getDb();
    const users = db.collection('users');
    const uid = new ObjectId(req.user!.userId);

    const taken = await users.findOne({
      phoneE164: parsed.e164,
      _id: { $ne: uid },
    });
    if (taken) {
      return res.status(400).json({ error: 'This phone number is already used by another account' });
    }

    await users.updateOne(
      { _id: uid },
      { $set: { phoneE164: parsed.e164, updatedAt: new Date() } }
    );

    return res.status(200).json({ message: 'Phone number updated', phoneE164: parsed.e164 });
  } catch (error: unknown) {
    console.error('update-phone error:', error);
    return res.status(500).json({ error: 'Failed to update phone' });
  }
}

export default withAuth(handler);

/**
 * Login API Route
 * Authenticates user with email/password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { issueAuthToken } from '@/lib/jwt';
import { decideAccountAccess } from '@/lib/account-access';
import { unexpectedBody } from '@/lib/public-error';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Find user
    const user = await users.findOne({ email });
    if (!user) {
      console.error('Login attempt failed');
      return res.status(401).json({ error: 'Invalid email or password. Please check your credentials.' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.error('Login attempt failed');
      return res.status(401).json({ error: 'Invalid email or password. Please check your credentials.' });
    }

    const userId = user._id.toString();
    const decision = decideAccountAccess({ userId, record: user });
    if (!decision.ok) {
      const userStatus = user.status || 'approved';
      if (userStatus === 'pending') {
        return res.status(403).json({
          error: 'Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.',
        });
      }
      if (userStatus === 'rejected') {
        return res.status(403).json({
          error: 'Your registration has been rejected. Please contact support for more information.',
        });
      }
      return res.status(403).json({ error: 'Account is not active' });
    }

    const token = issueAuthToken({
      userId: decision.user.userId,
      email: decision.user.email,
      role: decision.user.role,
      generation: user.sessionGeneration,
    });

    res.json({
      token,
      user: {
        id: decision.user.userId,
        email: decision.user.email,
        name: user.name,
        role: decision.user.role,
        status: decision.user.status,
      },
    });
  } catch (error: any) {
    res.status(500).json(unexpectedBody('login', error));
  }
}


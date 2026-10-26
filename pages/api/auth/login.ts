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

const INVALID_LOGIN = 'Invalid email or password. Please check your credentials.';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.JWT_SECRET?.trim()) {
    console.error('Login: JWT_SECRET is not set — cannot issue tokens');
    return res.status(500).json(unexpectedBody('login'));
  }

  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { email, password } = body as { email?: unknown; password?: unknown };
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const emailNorm = email.trim().toLowerCase();
    const db = await getDb();
    const users = db.collection('users');
    const user = await users.findOne({ email: emailNorm });
    if (!user || typeof user.password !== 'string' || !user.password) {
      console.error('Login attempt failed');
      return res.status(401).json({ error: INVALID_LOGIN });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.error('Login attempt failed');
      return res.status(401).json({ error: INVALID_LOGIN });
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
    if (!token || typeof token !== 'string' || !token.trim()) {
      console.error('Login: generateToken returned an empty token');
      return res.status(500).json(unexpectedBody('login'));
    }

    res.status(200).json({
      token: token.trim(),
      user: {
        id: decision.user.userId,
        email: decision.user.email,
        name: user.name,
        role: decision.user.role,
        status: decision.user.status,
      },
    });
  } catch (error: unknown) {
    res.status(500).json(unexpectedBody('login', error));
  }
}

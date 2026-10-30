/**
 * Login API Route
 * Authenticates user with email/password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { issueAuthToken } from '@/lib/jwt';
import { decideAccountAccess } from '@/lib/account-access';
import { unexpectedBody } from '@/lib/public-error';
import { LOGIN_RULES, createAuthLimiter, sendRefusal } from '@/lib/auth-rate-limit';
import { clientAddress } from '@/lib/client-ip';

const loginLimiter = createAuthLimiter(LOGIN_RULES);

const INVALID_LOGIN = 'Invalid email or password. Please check your credentials.';

/** Longer than any password the app accepts; refused before hashing so it cannot cost bcrypt time. */
const MAX_PASSWORD_CHARS = 1024;

/**
 * Compared when no account (or no stored password) matches, so a failed sign-in takes about as
 * long whether or not the address has an account. Same cost factor as stored passwords (10).
 * Made once, on first use, so it does not slow server start.
 */
let placeholderHash: string | null = null;
function unknownAccountHash(): string {
  if (!placeholderHash) placeholderHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
  return placeholderHash;
}

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
    // Counted before the user lookup and password check, whether or not the account exists.
    const limit = await loginLimiter.consume({ ip: clientAddress(req), email: emailNorm, getDb });
    if (!limit.allowed) return sendRefusal(res, limit);

    if (password.length > MAX_PASSWORD_CHARS) {
      console.warn(JSON.stringify({ event: 'login_failed', reason: 'password_too_long' }));
      return res.status(401).json({ error: INVALID_LOGIN });
    }

    const db = await getDb();
    const users = db.collection('users');
    const user = await users.findOne({ email: emailNorm });
    const hasPassword = Boolean(user && typeof user.password === 'string' && user.password);
    // Always one bcrypt comparison, so the response time does not reveal whether the account exists.
    const isValid = await bcrypt.compare(password, hasPassword ? user!.password : unknownAccountHash());
    if (!user || !hasPassword || !isValid) {
      console.warn(JSON.stringify({ event: 'login_failed', reason: 'invalid_credentials' }));
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

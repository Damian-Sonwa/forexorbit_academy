/**
 * Login API Route
 * Authenticates user with email/password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { generateToken } from '@/lib/jwt';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!process.env.JWT_SECRET?.trim()) {
    console.error('Login: JWT_SECRET is not set — cannot issue tokens');
    return res.status(500).json({ message: 'Server configuration error' });
  }

  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({
        message: 'Send JSON body with Content-Type: application/json (email and password)',
      });
    }

    const { email, password } = body as { email?: unknown; password?: unknown };

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Field email and password are required or invalid' });
    }

    const emailNorm =
      typeof email === 'string' ? email.trim().toLowerCase() : '';

    const db = await getDb();
    const users = db.collection('users');

    // Find user
    const user = await users.findOne({ email: emailNorm });
    if (!user) {
      console.log(`Login attempt failed: User not found for email: ${emailNorm}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Verify password (avoid 500 if account has no password hash, e.g. OAuth-only)
    if (typeof user.password !== 'string' || !user.password) {
      console.log(`Login attempt failed: No password set for email: ${emailNorm}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.log(`Login attempt failed: Invalid password for email: ${emailNorm}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check approval status for instructors and admins
    // Students are always approved, but check status for others
    // Super Admin is always approved
    const userStatus = user.status || 'approved'; // Default to approved for backward compatibility
    const isSuperAdmin = user.email === 'madudamian25@gmail.com';
    
    if (!isSuperAdmin && (user.role === 'instructor' || user.role === 'admin') && userStatus !== 'approved') {
      if (userStatus === 'pending' || userStatus === 'rejected') {
        return res.status(403).json({
          message: 'You are not authorized to perform this action',
        });
      }
    }

    // Determine role for token (Super Admin gets 'superadmin' role)
    const tokenRole = isSuperAdmin ? 'superadmin' : user.role;

    // Generate token (status is not included in token, only in user object)
    const token = generateToken({
      userId: user._id.toString(),
      email: user.email,
      role: tokenRole as 'superadmin' | 'admin' | 'instructor' | 'student',
    });

    if (!token || typeof token !== 'string' || !token.trim()) {
      console.error('Login: generateToken returned an empty token');
      return res.status(500).json({ message: 'Could not issue session token' });
    }

    // Frontend + Socket.io expect a JWT in `token` (see useAuth / useSocket).
    return res.status(200).json({
      token: token.trim(),
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: tokenRole, // Use tokenRole to include 'superadmin' if applicable
        status: userStatus,
      },
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Login error:', err.message, err.stack);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}


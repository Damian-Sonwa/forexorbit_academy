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
      console.log(`Login attempt failed: User not found for email: ${email}`);
      return res.status(401).json({ error: 'Invalid email or password. Please check your credentials or sign up for a new account.' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.log(`Login attempt failed: Invalid password for email: ${email}`);
      return res.status(401).json({ error: 'Invalid email or password. Please check your credentials.' });
    }

    // Check approval status for instructors and admins
    // Students are always approved, but check status for others
    // Super Admin is always approved
    const userStatus = user.status || 'approved'; // Default to approved for backward compatibility
    const isSuperAdmin = user.email === 'madudamian25@gmail.com';
    
    if (!isSuperAdmin && (user.role === 'instructor' || user.role === 'admin') && userStatus !== 'approved') {
      if (userStatus === 'pending') {
        return res.status(403).json({ 
          error: 'Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.' 
        });
      } else if (userStatus === 'rejected') {
        return res.status(403).json({ 
          error: 'Your registration has been rejected. Please contact support for more information.' 
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

    res.json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: tokenRole, // Use tokenRole to include 'superadmin' if applicable
        status: userStatus,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}


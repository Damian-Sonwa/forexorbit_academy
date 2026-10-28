/**
 * Signup API Route
 * Creates new user account with email/password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { issueAuthToken } from '@/lib/jwt';
import { unexpectedBody } from '@/lib/public-error';
import { isDuplicateKey, signupConflict } from '@/lib/signup-conflict';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password, name, role = 'student' } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (!['admin', 'instructor', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const nameTrim = String(name).trim();
    if (!nameTrim) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const db = await getDb();
    const users = db.collection('users');

    const existingUser = await users.findOne({ email: emailNorm });
    const conflict = signupConflict(existingUser, null);
    if (conflict) {
      return res.status(conflict.status).json(conflict.body);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Determine approval status:
    // - Students: automatically approved
    // - Instructors/Admins: require Super Admin approval (pending)
    const status = role === 'student' ? 'approved' : 'pending';

    // Create user
    const result = await users.insertOne({
      email: emailNorm,
      password: hashedPassword,
      name: nameTrim,
      role,
      status, // Add status field: 'pending', 'approved', or 'rejected'
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Only generate token if user is approved (students are auto-approved)
    let token = null;
    if (status === 'approved') {
      token = issueAuthToken({
        userId: result.insertedId.toString(),
        email: emailNorm,
        role: role as 'admin' | 'instructor' | 'student',
        generation: 0,
      });
    }

    res.status(201).json({
      token,
      user: {
        id: result.insertedId.toString(),
        email: emailNorm,
        name: nameTrim,
        role,
        status,
      },
      message: status === 'pending' 
        ? 'Your registration is pending approval. You will be notified once approved.'
        : 'Registration successful!',
    });
  } catch (error: any) {
    if (isDuplicateKey(error)) {
      return res.status(400).json(signupConflict(true, false)!.body);
    }
    res.status(500).json(unexpectedBody('signup', error));
  }
}


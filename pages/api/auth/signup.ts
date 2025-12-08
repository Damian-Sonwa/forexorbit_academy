/**
 * Signup API Route
 * Creates new user account with email/password
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
    const { email, password, name, role = 'student' } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['admin', 'instructor', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Check if user exists
    const existingUser = await users.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Determine approval status:
    // - Students: automatically approved
    // - Instructors/Admins: require Super Admin approval (pending)
    const status = role === 'student' ? 'approved' : 'pending';

    // Create user
    const result = await users.insertOne({
      email,
      password: hashedPassword,
      name,
      role,
      status, // Add status field: 'pending', 'approved', or 'rejected'
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Only generate token if user is approved (students are auto-approved)
    let token = null;
    if (status === 'approved') {
      token = generateToken({
        userId: result.insertedId.toString(),
        email,
        role: role as 'admin' | 'instructor' | 'student',
      });
    }

    res.status(201).json({
      token,
      user: {
        id: result.insertedId.toString(),
        email,
        name,
        role,
        status,
      },
      message: status === 'pending' 
        ? 'Your registration is pending approval. You will be notified once approved.'
        : 'Registration successful!',
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}


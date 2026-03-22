/**
 * Signup API Route
 * Creates new user account with email/password
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { generateToken } from '@/lib/jwt';
import { parseToE164 } from '@/lib/phone';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { email, password, name, phone, role = 'student' } = req.body;

    const nameTrim = typeof name === 'string' ? name.trim() : '';
    const emailStr = typeof email === 'string' ? email.trim() : '';

    // Validation
    if (!emailStr || !password || !nameTrim || !phone) {
      return res.status(400).json({ message: 'Name, email, phone, and password are required' });
    }

    const parsedPhone = parseToE164(String(phone));
    if (!parsedPhone) {
      return res.status(400).json({ message: 'Invalid phone number' });
    }
    const phoneE164 = parsedPhone.e164;

    if (!['admin', 'instructor', 'student'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const emailNorm = emailStr.toLowerCase();

    const db = await getDb();
    const users = db.collection('users');

    // Check if user exists
    const existingUser = await users.findOne({ email: emailNorm });
    if (existingUser) {
      return res.status(409).json({ message: 'This email/phone is already registered' });
    }

    const phoneRaw = String(phone).trim();
    const existingPhone = await users.findOne({
      $or: [{ phoneE164 }, { phone: phoneRaw }],
    });
    if (existingPhone) {
      return res.status(409).json({ message: 'This email/phone is already registered' });
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
      phone: phoneRaw,
      phoneE164,
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
      token = generateToken({
        userId: result.insertedId.toString(),
        email: emailNorm,
        role: role as 'admin' | 'instructor' | 'student',
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
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}


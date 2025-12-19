/**
 * Get Current User API Route
 * Returns authenticated user information
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  try {
    // Validate user is authenticated
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let db;
    try {
      db = await getDb();
    } catch (dbError) {
      console.error('Database connection error:', dbError);
      return res.status(500).json({ 
        error: 'Database connection failed',
        details: process.env.NODE_ENV === 'development' 
          ? (dbError instanceof Error ? dbError.message : 'Unknown error')
          : 'Please check server logs'
      });
    }

    const users = db.collection('users');

    let user;
    try {
      user = await users.findOne(
        { _id: new ObjectId(req.user.userId) },
        { projection: { password: 0 } }
      );
    } catch (queryError) {
      console.error('Database query error:', queryError);
      return res.status(500).json({ 
        error: 'Failed to query user',
        details: process.env.NODE_ENV === 'development' 
          ? (queryError instanceof Error ? queryError.message : 'Unknown error')
          : 'Please check server logs'
      });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Determine role (Super Admin gets 'superadmin' role)
    const isSuperAdmin = user.email === 'madudamian25@gmail.com';
    const role = isSuperAdmin ? 'superadmin' : user.role;

    // Determine learning level (default to beginner for students)
    let learningLevel = user.learningLevel || 'beginner';
    if (role === 'student' && !user.learningLevel) {
      learningLevel = 'beginner';
    } else if (role !== 'student') {
      // Instructors, admins, and super admins have access to all levels
      learningLevel = 'advanced';
    }

    res.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role,
      status: user.status || 'approved', // Include status field
      points: user.points || 0, // Include points for gamification
      studentDetails: user.studentDetails || null, // Include student onboarding data
      onboardingCompleted: user.onboardingCompleted || false, // Include onboarding completion status
      profilePhoto: user.profilePhoto || null, // Include profile photo
      learningLevel, // Include learning level for access control
    });
  } catch (error) {
    console.error('Get user error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errorMessage : 'Please check server logs'
    });
  }
}

export default withAuth(handler);


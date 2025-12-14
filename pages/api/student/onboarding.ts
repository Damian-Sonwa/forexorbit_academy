/**
 * Student Onboarding API Route
 * POST: Save/update student onboarding data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function saveOnboarding(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access this endpoint
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can complete onboarding' });
    }

    const {
      fullName,
      dateOfBirth,
      gender,
      contactNumber,
      educationLevel,
      certifications,
      tradingLevel,
      yearsOfExperience,
      preferredTopics,
      notificationPreferences,
    } = req.body;

    // FIX: Make validation less strict - allow partial updates for profile editing
    // Only require fullName for profile updates (other fields can be optional)
    if (!fullName) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Preferred topics can be empty for profile updates
    if (preferredTopics && !Array.isArray(preferredTopics)) {
      return res.status(400).json({ error: 'Preferred topics must be an array' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Update user with onboarding data
    const result = await users.updateOne(
      { _id: new ObjectId(req.user!.userId) },
      {
        $set: {
          name: fullName, // Update main name field
          studentDetails: {
            fullName,
            dateOfBirth,
            gender: gender || null,
            contactNumber,
            educationLevel,
            certifications: certifications || null,
            tradingLevel,
            yearsOfExperience,
            preferredTopics,
            notificationPreferences: notificationPreferences || {
              email: true,
              sms: false,
              push: true,
            },
            completedAt: new Date(),
          },
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Onboarding data saved successfully',
    });
  } catch (error: any) {
    console.error('Save onboarding error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(saveOnboarding, ['student']);











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
      profilePhoto, // FIX: Include profilePhoto to preserve it when saving profile
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

    // FIX: Get current user to preserve existing profilePhoto if not provided
    const currentUser = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { profilePhoto: 1 } }
    );

    // Update user with onboarding data
    // FIX: Preserve profilePhoto - only update if new one is provided, otherwise keep existing
    const updateData: any = {
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
      // Store learning level at top level for easy access (synced with tradingLevel from onboarding)
      learningLevel: tradingLevel || 'beginner',
      updatedAt: new Date(),
    };

    // FIX: Preserve profilePhoto - update only if provided, otherwise keep existing
    if (profilePhoto) {
      updateData.profilePhoto = profilePhoto;
    } else if (currentUser?.profilePhoto) {
      // Keep existing profilePhoto if not provided in request
      updateData.profilePhoto = currentUser.profilePhoto;
    }

    const result = await users.updateOne(
      { _id: new ObjectId(req.user!.userId) },
      {
        $set: updateData,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Onboarding data saved successfully',
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Save onboarding error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(saveOnboarding, ['student']);











/**
 * Mark Onboarding as Complete API Route
 * PUT: Mark student onboarding as complete
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function completeOnboarding(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access this endpoint
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can complete onboarding' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Mark onboarding as complete
    const result = await users.updateOne(
      { _id: new ObjectId(req.user!.userId) },
      {
        $set: {
          onboardingCompleted: true,
          onboardingCompletedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Onboarding completed successfully',
    });
  } catch (error: any) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(completeOnboarding, ['student']);








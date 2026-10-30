import { unexpectedBody } from '@/lib/public-error';
/**
 * Student Onboarding API Route
 * POST: Save/update student onboarding data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { checkOnboardingInput } from '@/lib/onboarding-input';

async function saveOnboarding(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access this endpoint
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can complete onboarding' });
    }

    // Types, lengths and the level are checked (lib/onboarding-input.js).
    const input = checkOnboardingInput(req.body);
    if (!input.ok) {
      return res.status(input.status).json({ error: input.error });
    }

    const db = await getDb();
    const users = db.collection('users');
    const userId = new ObjectId(req.user!.userId);
    const now = new Date();

    // Onboarding answers and the display name. learningLevel is not changed here.
    const result = await users.updateOne(
      { _id: userId },
      {
        $set: {
          name: input.name,
          studentDetails: { ...input.details, completedAt: now },
          updatedAt: now,
        },
      }
    );
    // Placement: the self-reported level sets learningLevel only if the account has none yet.
    // Later changes come from course progress, so a student cannot raise their own level.
    if (result.matchedCount > 0) {
      await users.updateOne({ _id: userId, learningLevel: null }, { $set: { learningLevel: input.level, levelUpdatedAt: now } });
    }

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Onboarding data saved successfully',
    });
  } catch (error: any) {
    console.error('Save onboarding error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(saveOnboarding, ['student']);











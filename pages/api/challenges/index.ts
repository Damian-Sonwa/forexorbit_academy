/**
 * Daily Challenges API Route
 * GET: Get daily challenges
 * POST: Complete challenge (students only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getChallenges(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const challenges = db.collection('challenges');
    const challengeCompletions = db.collection('challengeCompletions');

    // Get today's challenges
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const challengesList = await challenges
      .find({
        date: {
          $gte: today,
          $lt: tomorrow,
        },
      })
      .toArray();

    // For students, include completion status
    if (req.user!.role === 'student') {
      const userId = req.user!.userId;
      const enrichedChallenges = await Promise.all(
        challengesList.map(async (challenge) => {
          const completion = await challengeCompletions.findOne({
            userId,
            challengeId: challenge._id.toString(),
          });

          return {
            ...challenge,
            completed: !!completion,
            completedAt: completion?.completedAt || null,
          };
        })
      );

      return res.json(enrichedChallenges);
    }

    res.json(challengesList);
  } catch (error: any) {
    console.error('Get challenges error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function completeChallenge(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const { challengeId, answer } = req.body;
    const userId = req.user!.userId;

    if (!challengeId) {
      return res.status(400).json({ error: 'Challenge ID required' });
    }

    const db = await getDb();
    const challenges = db.collection('challenges');
    const challengeCompletions = db.collection('challengeCompletions');
    const users = db.collection('users');

    // Get challenge
    const challenge = await challenges.findOne({ _id: new ObjectId(challengeId) });
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Check if already completed
    const existing = await challengeCompletions.findOne({
      userId,
      challengeId,
    });

    if (existing) {
      return res.status(400).json({ error: 'Challenge already completed' });
    }

    // Verify answer if provided
    let isCorrect = true;
    if (challenge.answer && answer) {
      isCorrect = answer.toLowerCase().trim() === challenge.answer.toLowerCase().trim();
    }

    // Record completion
    await challengeCompletions.insertOne({
      userId,
      challengeId,
      answer,
      isCorrect,
      completedAt: new Date(),
      createdAt: new Date(),
    });

    // Award points
    if (isCorrect && challenge.points) {
      await users.updateOne(
        { _id: new ObjectId(userId) },
        { $inc: { points: challenge.points } }
      );
    }

    res.json({
      success: true,
      isCorrect,
      pointsEarned: isCorrect ? challenge.points : 0,
    });
  } catch (error: any) {
    console.error('Complete challenge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getChallenges(req, res);
  } else if (req.method === 'POST') {
    return completeChallenge(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);








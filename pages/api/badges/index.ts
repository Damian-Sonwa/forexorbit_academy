/**
 * Badges API Route
 * GET: List badges (all users or user-specific)
 * POST: Create badge (admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getBadges(req: AuthRequest, res: NextApiResponse) {
  try {
    const { userId } = req.query;
    const db = await getDb();
    const badges = db.collection('badges');
    const userBadges = db.collection('userBadges');

    if (userId || req.user!.role === 'student') {
      // Get user-specific badges
      const targetUserId = (userId as string) || req.user!.userId;
      const earnedBadges = await userBadges.find({ userId: targetUserId }).toArray();
      
      const badgeIds = earnedBadges.map(b => b.badgeId);
      const badgesList = await badges.find({ _id: { $in: badgeIds.map(id => new ObjectId(id)) } }).toArray();

      // Merge with earned date
      const enrichedBadges = badgesList.map(badge => {
        const earned = earnedBadges.find(eb => eb.badgeId === badge._id.toString());
        return {
          ...badge,
          earned: true,
          earnedAt: earned?.earnedAt || null,
        };
      });

      res.json(enrichedBadges);
    } else {
      // Get all badges (for admin/instructor)
      const badgesList = await badges.find({}).sort({ pointsRequired: 1 }).toArray();
      res.json(badgesList);
    }
  } catch (error: any) {
    console.error('Get badges error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createBadge(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { name, description, icon, pointsRequired, category } = req.body;

    if (!name || !description || pointsRequired === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const badges = db.collection('badges');

    const result = await badges.insertOne({
      name,
      description,
      icon: icon || '🏆',
      pointsRequired: parseInt(pointsRequired),
      category: category || 'general',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      ...req.body,
    });
  } catch (error: any) {
    console.error('Create badge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getBadges(req, res);
  } else if (req.method === 'POST') {
    return createBadge(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


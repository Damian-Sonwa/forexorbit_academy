/**
 * Experts API Route
 * GET: Get list of available experts
 * PUT: Update expert availability (experts only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getExperts(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    // Get all users marked as experts
    const experts = await users
      .find({ 
        isExpert: true,
        $or: [
          { role: 'instructor' },
          { role: 'admin' },
          { role: 'superadmin' }
        ]
      })
      .project({ 
        _id: 1, 
        name: 1, 
        email: 1, 
        profilePhoto: 1, 
        isExpert: 1, 
        expertAvailable: 1,
        role: 1,
      })
      .toArray();

    res.json(
      experts.map((expert) => ({
        _id: expert._id.toString(),
        name: expert.name,
        email: expert.email,
        profilePhoto: expert.profilePhoto,
        isExpert: expert.isExpert,
        expertAvailable: expert.expertAvailable !== false, // Default to true
        role: expert.role,
      }))
    );
  } catch (error: any) {
    console.error('Get experts error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function updateAvailability(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only experts can update their availability
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only experts can update availability' });
    }

    const { available } = req.body;

    if (typeof available !== 'boolean') {
      return res.status(400).json({ message: 'Available must be a boolean' });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Verify user is an expert
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { isExpert: 1 } }
    );

    if (!user?.isExpert) {
      return res.status(403).json({ message: 'You are not marked as an expert' });
    }

    await users.updateOne(
      { _id: new ObjectId(req.user!.userId) },
      { $set: { expertAvailable: available } }
    );

    res.json({
      success: true,
      message: `Availability updated to ${available ? 'available' : 'unavailable'}`,
    });
  } catch (error: any) {
    console.error('Update expert availability error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getExperts(req, res);
  } else if (req.method === 'PUT') {
    return updateAvailability(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'PUT']);
    res.status(405).json({ message: `Method ${req.method} not allowed` });
  }
});









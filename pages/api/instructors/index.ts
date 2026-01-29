/**
 * Instructors API Route
 * GET: List all instructors
 * POST: Create new instructor (admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';

// GET all instructors
async function getInstructors(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const instructors = db.collection('instructors');

    const instructorsList = await instructors.find({}).sort({ createdAt: -1 }).toArray();

    res.json(instructorsList);
  } catch (error: any) {
    console.error('Get instructors error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// POST create instructor
async function createInstructor(req: AuthRequest, res: NextApiResponse) {
  try {
    const { name, title, description, imageUrl } = req.body;

    if (!name || !title || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const instructors = db.collection('instructors');

    const result = await instructors.insertOne({
      name,
      title,
      description,
      imageUrl: imageUrl || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      _id: result.insertedId.toString(),
      name,
      title,
      description,
      imageUrl: imageUrl || '',
    });
  } catch (error: any) {
    console.error('Create instructor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getInstructors(req as AuthRequest, res);
  } else if (req.method === 'POST') {
    return withAuth(createInstructor, ['admin', 'superadmin'])(req as AuthRequest, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}




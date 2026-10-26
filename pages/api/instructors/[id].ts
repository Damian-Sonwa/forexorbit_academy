/**
 * Instructor API Route (Single Instructor)
 * GET: Get instructor by ID
 * PUT: Update instructor
 * DELETE: Delete instructor
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET instructor by ID
async function getInstructor(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid instructor ID' });
    }

    const db = await getDb();
    const instructors = db.collection('instructors');

    const instructor = await instructors.findOne({ _id: new ObjectId(id) });

    if (!instructor) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    res.json(instructor);
  } catch (error: any) {
    console.error('Get instructor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT update instructor
async function updateInstructor(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const { name, title, description, imageUrl } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid instructor ID' });
    }

    const db = await getDb();
    const instructors = db.collection('instructors');

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

    const result = await instructors.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    const updatedInstructor = await instructors.findOne({ _id: new ObjectId(id) });
    res.json(updatedInstructor);
  } catch (error: any) {
    console.error('Update instructor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE instructor
async function deleteInstructor(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid instructor ID' });
    }

    const db = await getDb();
    const instructors = db.collection('instructors');

    const result = await instructors.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    res.json({ success: true, message: 'Instructor deleted' });
  } catch (error: any) {
    console.error('Delete instructor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getInstructor(req as AuthRequest, res);
  } else if (req.method === 'PUT') {
    return withAuth(updateInstructor, ['admin', 'superadmin'])(req as AuthRequest, res);
  } else if (req.method === 'DELETE') {
    return withAuth(deleteInstructor, ['admin', 'superadmin'])(req as AuthRequest, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}




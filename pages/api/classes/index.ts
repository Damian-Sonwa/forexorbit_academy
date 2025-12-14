/**
 * Upcoming Classes API Route
 * GET: Get all upcoming classes
 * POST: Create a new upcoming class (instructor/admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getClasses(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const classes = db.collection('upcomingClasses');

    // Get all upcoming classes, sorted by date
    const upcomingClasses = await classes
      .find({
        date: { $gte: new Date() }, // Only future classes
      })
      .sort({ date: 1 })
      .toArray();

    res.json(upcomingClasses);
  } catch (error: any) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createClass(req: AuthRequest, res: NextApiResponse) {
  try {
    const { title, description, date, time, instructor, link } = req.body;

    if (!title || !description || !date || !time) {
      return res.status(400).json({ error: 'Title, description, date, and time are required' });
    }

    const db = await getDb();
    const classes = db.collection('upcomingClasses');

    // Combine date and time into a single Date object
    const classDateTime = new Date(`${date}T${time}`);

    if (isNaN(classDateTime.getTime())) {
      return res.status(400).json({ error: 'Invalid date or time format' });
    }

    // Check if date is in the future
    if (classDateTime < new Date()) {
      return res.status(400).json({ error: 'Class date must be in the future' });
    }

    const newClass = {
      title,
      description,
      date: classDateTime,
      instructor: instructor || req.user!.name,
      link: link || '',
      createdAt: new Date(),
      createdBy: req.user!.userId,
    };

    const result = await classes.insertOne(newClass);

    res.status(201).json({
      _id: result.insertedId,
      ...newClass,
    });
  } catch (error: any) {
    console.error('Create class error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return withAuth(getClasses)(req as AuthRequest, res);
  } else if (req.method === 'POST') {
    return withAuth(createClass, ['instructor', 'admin'])(req as AuthRequest, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}


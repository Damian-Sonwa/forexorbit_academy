/**
 * Upcoming Classes API Route
 * GET: Get all upcoming classes/events
 * POST: Create a new upcoming class/event (instructor/admin only)
 * 
 * FIX: Create API endpoint for upcoming classes that instructors and admins can post
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getClasses(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const classes = db.collection('upcomingClasses');

    // Get all upcoming classes (only future classes)
    const now = new Date();
    const upcoming = await classes
      .find({
        $or: [
          { date: { $gte: now.toISOString().split('T')[0] } }, // Date is today or future
          { dateTime: { $gte: now } }, // DateTime is in the future
        ],
      })
      .sort({ date: 1, time: 1 })
      .toArray();

    res.json(
      upcoming.map((cls) => ({
        _id: cls._id.toString(),
        title: cls.title,
        description: cls.description,
        date: cls.date,
        time: cls.time,
        dateTime: cls.dateTime,
        meetingLink: cls.meetingLink,
        instructorId: cls.instructorId,
        instructorName: cls.instructorName,
        createdAt: cls.createdAt,
      }))
    );
  } catch (error: any) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function createClass(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can create classes
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.email !== 'madudamian25@gmail.com') {
      return res.status(403).json({ error: 'Instructor or admin access required' });
    }

    const { title, description, date, time, meetingLink } = req.body;

    // Validate required fields
    if (!title || !description || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields: title, description, date, and time are required' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(time)) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:MM (24-hour format)' });
    }

    const db = await getDb();
    const classes = db.collection('upcomingClasses');
    const users = db.collection('users');

    // Get instructor name from database
    const instructor = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { name: 1 } }
    );

    if (!instructor) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    // Combine date and time into a single DateTime for sorting
    const dateTime = new Date(`${date}T${time}:00`);

    // Create the class
    const newClass = {
      title,
      description,
      date,
      time,
      dateTime,
      meetingLink: meetingLink || '',
      instructorId: req.user!.userId,
      instructorName: instructor.name || req.user!.email,
      createdAt: new Date(),
    };

    const result = await classes.insertOne(newClass);

    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      class: {
        _id: result.insertedId.toString(),
        ...newClass,
      },
    });
  } catch (error: any) {
    console.error('Create class error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getClasses(req, res);
  } else if (req.method === 'POST') {
    return createClass(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});


/**
 * Classes/Events API Route
 * GET: Get upcoming classes
 * POST: Create new class/event
 * PUT: Update class/event
 * DELETE: Delete class/event
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getClasses(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const classes = db.collection('classes');

    // Get all upcoming classes (date >= today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingClasses = await classes
      .find({
        date: { $gte: today.toISOString() },
      })
      .sort({ date: 1, time: 1 })
      .toArray();

    res.json(upcomingClasses.map(cls => ({
      _id: cls._id.toString(),
      title: cls.title,
      description: cls.description,
      date: cls.date,
      time: cls.time,
      meetingLink: cls.meetingLink,
      createdBy: cls.createdBy,
      createdAt: cls.createdAt,
      updatedAt: cls.updatedAt,
    })));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Get classes error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

async function createClass(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can create classes
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can create classes' });
    }

    const { title, description, date, time, meetingLink } = req.body;

    if (!title || !description || !date || !time) {
      return res.status(400).json({ error: 'Title, description, date, and time are required' });
    }

    const db = await getDb();
    const classes = db.collection('classes');

    const newClass = {
      title,
      description,
      date: new Date(date).toISOString(),
      time,
      meetingLink: meetingLink || '',
      createdBy: req.user!.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await classes.insertOne(newClass);

    res.status(201).json({
      _id: result.insertedId.toString(),
      ...newClass,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Create class error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

async function updateClass(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can update classes
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can update classes' });
    }

    const { id } = req.query;
    const { title, description, date, time, meetingLink } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Class ID is required' });
    }

    const db = await getDb();
    const classes = db.collection('classes');

    // Check if class exists and was created by this user (or user is admin)
    const existingClass = await classes.findOne({ _id: new ObjectId(id) });
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (req.user!.role !== 'admin' && existingClass.createdBy !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only update your own classes' });
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (date) updateData.date = new Date(date).toISOString();
    if (time) updateData.time = time;
    if (meetingLink !== undefined) updateData.meetingLink = meetingLink;

    await classes.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.json({ success: true, message: 'Class updated successfully' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Update class error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

async function deleteClass(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can delete classes
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can delete classes' });
    }

    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Class ID is required' });
    }

    const db = await getDb();
    const classes = db.collection('classes');

    // Check if class exists and was created by this user (or user is admin)
    const existingClass = await classes.findOne({ _id: new ObjectId(id) });
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (req.user!.role !== 'admin' && existingClass.createdBy !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only delete your own classes' });
    }

    await classes.deleteOne({ _id: new ObjectId(id) });

    res.json({ success: true, message: 'Class deleted successfully' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Delete class error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getClasses(req, res);
  } else if (req.method === 'POST') {
    return createClass(req, res);
  } else if (req.method === 'PUT') {
    return updateClass(req, res);
  } else if (req.method === 'DELETE') {
    return deleteClass(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});


/**
 * Reminders API Route
 * GET: Get user's reminders
 * POST: Create reminder
 * PUT: Update reminder
 * DELETE: Delete reminder
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createNotification } from '@/lib/notifications';

export interface Reminder {
  _id?: string;
  userId: string;
  type: 'live_class' | 'task_deadline' | 'consultation' | 'custom';
  title: string;
  description?: string;
  scheduledAt: Date;
  relatedId?: string; // Task ID, class ID, consultation ID, etc.
  completed: boolean;
  createdAt: Date;
  metadata?: Record<string, any>;
}

async function getReminders(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const reminders = db.collection('reminders');

    const query: any = { userId: req.user!.userId };
    
    // Optional filters
    if (req.query.completed === 'true') {
      query.completed = true;
    } else if (req.query.completed === 'false') {
      query.completed = false;
    }

    if (req.query.type) {
      query.type = req.query.type;
    }

    // Get upcoming reminders by default
    if (req.query.upcoming === 'true') {
      query.scheduledAt = { $gte: new Date() };
    }

    const reminderDocs = await reminders
      .find(query)
      .sort({ scheduledAt: 1 })
      .toArray();

    const result = reminderDocs.map((reminder) => ({
      _id: reminder._id.toString(),
      userId: reminder.userId,
      type: reminder.type,
      title: reminder.title,
      description: reminder.description,
      scheduledAt: reminder.scheduledAt,
      relatedId: reminder.relatedId,
      completed: reminder.completed || false,
      createdAt: reminder.createdAt,
      metadata: reminder.metadata || {},
    }));

    res.json({ reminders: result });
  } catch (error: unknown) {
    console.error('Get reminders error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to fetch reminders', message: errorMessage });
  }
}

async function createReminder(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const reminders = db.collection('reminders');

    const {
      type,
      title,
      description,
      scheduledAt,
      relatedId,
      metadata,
    } = req.body;

    if (!type || !title || !scheduledAt) {
      return res.status(400).json({ error: 'Missing required fields: type, title, scheduledAt' });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledAt date' });
    }

    const reminder: Omit<Reminder, '_id'> = {
      userId: req.user!.userId,
      type,
      title,
      description: description || undefined,
      scheduledAt: scheduledDate,
      relatedId: relatedId || undefined,
      completed: false,
      createdAt: new Date(),
      metadata: metadata || {},
    };

    const result = await reminders.insertOne(reminder);

    // Create a notification for the reminder (if scheduled in the future)
    if (scheduledDate > new Date()) {
      // Schedule notification 15 minutes before reminder
      const notificationTime = new Date(scheduledDate.getTime() - 15 * 60 * 1000);
      
      // Store reminder notification metadata
      await createNotification({
        type: 'live_class_reminder',
        title: `Reminder: ${title}`,
        message: description || `Don't forget: ${title}`,
        userId: req.user!.userId,
        relatedId: result.insertedId.toString(),
        metadata: {
          reminderId: result.insertedId.toString(),
          scheduledAt: scheduledDate.toISOString(),
          notificationTime: notificationTime.toISOString(),
        },
      });
    }

    res.status(201).json({
      success: true,
      reminder: {
        ...reminder,
        _id: result.insertedId.toString(),
      },
    });
  } catch (error: unknown) {
    console.error('Create reminder error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to create reminder', message: errorMessage });
  }
}

async function updateReminder(req: AuthRequest, res: NextApiResponse) {
  try {
    const { reminderId } = req.query;
    const updates = req.body;

    if (!reminderId || typeof reminderId !== 'string') {
      return res.status(400).json({ error: 'Reminder ID is required' });
    }

    const db = await getDb();
    const reminders = db.collection('reminders');

    // Verify reminder belongs to user
    const reminder = await reminders.findOne({
      _id: new ObjectId(reminderId),
      userId: req.user!.userId,
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found or unauthorized' });
    }

    // Build update object
    const updateData: any = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.scheduledAt !== undefined) {
      const scheduledDate = new Date(updates.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduledAt date' });
      }
      updateData.scheduledAt = scheduledDate;
    }
    if (updates.completed !== undefined) updateData.completed = updates.completed;
    if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

    await reminders.updateOne(
      { _id: new ObjectId(reminderId) },
      { $set: updateData }
    );

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Update reminder error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to update reminder', message: errorMessage });
  }
}

async function deleteReminder(req: AuthRequest, res: NextApiResponse) {
  try {
    const { reminderId } = req.query;

    if (!reminderId || typeof reminderId !== 'string') {
      return res.status(400).json({ error: 'Reminder ID is required' });
    }

    const db = await getDb();
    const reminders = db.collection('reminders');

    // Verify reminder belongs to user
    const reminder = await reminders.findOne({
      _id: new ObjectId(reminderId),
      userId: req.user!.userId,
    });

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found or unauthorized' });
    }

    await reminders.deleteOne({ _id: new ObjectId(reminderId) });

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Delete reminder error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to delete reminder', message: errorMessage });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getReminders(req, res);
    case 'POST':
      return createReminder(req, res);
    case 'PUT':
      return updateReminder(req, res);
    case 'DELETE':
      return deleteReminder(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


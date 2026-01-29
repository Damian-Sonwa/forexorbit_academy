/**
 * Reminder Check API Route
 * Checks for due reminders and triggers notifications
 * This can be called periodically (e.g., via cron job or scheduled task)
 * POST /api/reminders/check
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createNotification } from '@/lib/notifications';

async function checkReminders(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only allow admin/superadmin or system calls
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const db = await getDb();
    const reminders = db.collection('reminders');

    const now = new Date();
    const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);

    // Find reminders that are due within the next 15 minutes and not completed
    const dueReminders = await reminders
      .find({
        completed: false,
        scheduledAt: {
          $gte: now,
          $lte: fifteenMinutesFromNow,
        },
      })
      .toArray();

    const notificationsCreated: string[] = [];

    for (const reminder of dueReminders) {
      try {
        // Check if notification already exists for this reminder
        const notifications = db.collection('notifications');
        const existingNotif = await notifications.findOne({
          type: 'live_class_reminder',
          userId: reminder.userId,
          'metadata.reminderId': reminder._id.toString(),
          read: false,
        });

        if (!existingNotif) {
          // Create notification
          const notifId = await createNotification({
            type: 'live_class_reminder',
            title: `Reminder: ${reminder.title}`,
            message: reminder.description || `Don't forget: ${reminder.title}`,
            userId: reminder.userId,
            relatedId: reminder._id.toString(),
            roleTarget: 'student',
            metadata: {
              reminderId: reminder._id.toString(),
              reminderType: reminder.type,
              scheduledAt: reminder.scheduledAt.toISOString(),
            },
          });

          notificationsCreated.push(notifId);

          // Emit socket event
          if (req.io) {
            req.io.to(`user:${reminder.userId}`).emit('notification', {
              type: 'live_class_reminder',
              title: `Reminder: ${reminder.title}`,
              message: reminder.description || `Don't forget: ${reminder.title}`,
              relatedId: reminder._id.toString(),
              read: false,
              createdAt: new Date(),
            });
          }
        }
      } catch (error) {
        console.error(`Failed to create notification for reminder ${reminder._id}:`, error);
        // Continue with other reminders
      }
    }

    res.json({
      success: true,
      checked: dueReminders.length,
      notificationsCreated: notificationsCreated.length,
    });
  } catch (error: unknown) {
    console.error('Check reminders error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: 'Failed to check reminders', message: errorMessage });
  }
}

export default withAuth(checkReminders, ['admin', 'superadmin']);


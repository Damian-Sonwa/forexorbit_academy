/**
 * Complete Demo Task API Route
 * POST: Mark a task as completed by student
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function completeTask(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can complete tasks
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can complete tasks' });
    }

    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Task ID is required' });
    }

    const db = await getDb();
    const tasks = db.collection('demoTasks');

    // Check if task exists and is assigned to this student
    const task = await tasks.findOne({
      _id: new ObjectId(id),
      $or: [
        { assignedTo: req.user!.userId },
        { assignedTo: null }, // General tasks
      ],
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found or not assigned to you' });
    }

    if (task.completed) {
      return res.status(400).json({ error: 'Task is already completed' });
    }

    // Mark task as completed
    await tasks.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          completed: true,
          completedAt: new Date(),
          completedBy: req.user!.userId,
          updatedAt: new Date(),
        },
      }
    );

    res.json({ success: true, message: 'Task marked as completed' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Complete task error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(completeTask, ['student']);


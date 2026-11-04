import { unexpectedBody } from '@/lib/public-error';
/**
 * Complete Demo Task API Route
 * POST: Mark a task as completed by student
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isStoredId } from '@/lib/account-access';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { allowRequest, tradingLimiter } from '@/lib/content-rate-limit';
import { completionFor } from '@/lib/practice-desk';

async function completeTask(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    // Only students can complete tasks
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can complete tasks' });
    }

    const { id } = req.query;

    if (!isStoredId(id)) {
      return res.status(400).json({ error: 'Task ID is required' });
    }
    if (!(await allowRequest(tradingLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;

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

    if (completionFor(task, req.user!.userId).completed) {
      return res.status(400).json({ error: 'Task is already completed' });
    }

    // Completion belongs to this student: a task for everyone stays open for everyone else.
    const now = new Date();
    await tasks.updateOne(
      { _id: new ObjectId(id) },
      { $set: { [`completions.${req.user!.userId}`]: now, updatedAt: now } }
    );

    res.json({ success: true, message: 'Task marked as completed' });
  } catch (error: unknown) {
    console.error('Complete task error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(completeTask, ['student']);


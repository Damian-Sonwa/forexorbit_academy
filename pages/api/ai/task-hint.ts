import { unexpectedBody } from '@/lib/public-error';
/**
 * AI API: Get Task Hint
 * Provides AI-powered hints for demo tasks
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getTaskHint, isAIConfigured } from '@/lib/ai';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { taskIsFor } from '@/lib/practice-desk';
import { taskForStaff } from '@/lib/practical-tasks';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI service is not configured' });
  }

  try {
    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }

    // Fetch task details
    const db = await getDb();
    const tasks = db.collection('demoTasks');
    const task = typeof taskId === 'string' && ObjectId.isValid(taskId) && taskId.length === 24 ? await tasks.findOne({ _id: new ObjectId(taskId) }) : null;

    // A practical task is only hinted to its recipients (a draft or another student's task is
    // reported as not found), and to staff who can manage it.
    const practicalHidden = task && task.schema === 'practical_v2' && (req.user!.role === 'student' ? !taskIsFor(task, req.user!.userId) : !(await taskForStaff(db, { userId: req.user!.userId, role: req.user!.role }, String(task._id))).ok);
    if (!task || practicalHidden) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get user level for context
    const users = db.collection('users');
    const user = await users.findOne(
      { _id: new ObjectId(req.user!.userId) },
      { projection: { learningLevel: 1, 'studentDetails.tradingLevel': 1 } }
    );

    const userLevel = user?.learningLevel || user?.studentDetails?.tradingLevel || 'beginner';

    const hint = await getTaskHint(
      task.title,
      task.description || '',
      task.level || userLevel,
      req.user!.userId
    );

    res.json({ hint });
  } catch (error: unknown) {
    console.error('AI task hint error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(handler, ['student', 'instructor', 'admin', 'superadmin']);


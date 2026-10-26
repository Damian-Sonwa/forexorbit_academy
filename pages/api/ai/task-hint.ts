/**
 * AI API: Get Task Hint
 * Provides AI-powered hints for demo tasks
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getTaskHint, isAIConfigured } from '@/lib/ai';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

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
    const task = await tasks.findOne({ _id: new ObjectId(taskId) });

    if (!task) {
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
    console.error('AI task hint error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get AI hint';
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(handler, ['student', 'instructor', 'admin', 'superadmin']);


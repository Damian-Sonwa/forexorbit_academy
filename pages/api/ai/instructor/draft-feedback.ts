/**
 * AI API: Draft Feedback
 * Provides AI-drafted feedback for student submissions (editable by instructor)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { draftFeedback, isAIConfigured } from '@/lib/ai';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.user!.role !== 'instructor' && req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only instructors and admins can draft feedback' });
  }

  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI service is not configured' });
  }

  try {
    const { submissionId } = req.body;

    if (!submissionId) {
      return res.status(400).json({ error: 'submissionId is required' });
    }

    const db = await getDb();
    const submissions = db.collection('demoTaskSubmissions');
    const tasks = db.collection('demoTasks');
    const users = db.collection('users');

    // Get submission
    const submission = await submissions.findOne({ _id: new ObjectId(submissionId) });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Get task
    let task = null;
    if (submission.taskId) {
      task = await tasks.findOne(
        { _id: new ObjectId(submission.taskId) },
        { projection: { title: 1, description: 1 } }
      );
    }

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get student level
    const student = await users.findOne(
      { _id: new ObjectId(submission.studentId) },
      { projection: { learningLevel: 1, 'studentDetails.tradingLevel': 1 } }
    );

    const studentLevel = student?.learningLevel || student?.studentDetails?.tradingLevel || 'beginner';

    const submissionData = {
      taskTitle: task.title,
      taskDescription: task.description || '',
      studentReasoning: submission.reasoning || '',
      studentLevel,
    };

    const feedback = await draftFeedback(submissionData, req.user!.userId);

    res.json({ feedback });
  } catch (error: unknown) {
    console.error('AI draft feedback error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to draft feedback';
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(handler, ['instructor', 'admin', 'superadmin']);


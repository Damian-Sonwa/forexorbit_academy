/**
 * Get Submissions for a Specific Task API Route
 * GET: Get all student submissions for a specific demo task
 * Only accessible to instructors and admins
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getTaskSubmissions(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can view submissions
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can view submissions' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Task ID is required' });
    }

    const db = await getDb();
    const journal = db.collection('demoTradeJournal');
    const users = db.collection('users');
    const tasks = db.collection('demoTasks');

    // Verify task exists
    const task = await tasks.findOne({ _id: new ObjectId(id) });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // For instructors, verify they created this task
    if (req.user!.role === 'instructor' && task.assignedBy !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only view submissions for your own tasks' });
    }

    // Get all submissions for this task
    const submissions = await journal
      .find({ taskId: id })
      .sort({ createdAt: -1 })
      .toArray();

    // Populate student details
    const submissionsWithDetails = await Promise.all(
      submissions.map(async (submission) => {
        const student = await users.findOne(
          { _id: new ObjectId(submission.studentId) },
          { projection: { name: 1, email: 1 } }
        );

        return {
          _id: submission._id.toString(),
          studentId: submission.studentId,
          studentName: student?.name || 'Unknown Student',
          studentEmail: student?.email || 'Unknown Email',
          taskId: submission.taskId,
          screenshot: submission.screenshot, // Cloudinary URL
          notes: submission.notes,
          pair: submission.pair,
          direction: submission.direction,
          entryPrice: submission.entryPrice,
          stopLoss: submission.stopLoss,
          takeProfit: submission.takeProfit,
          lotSize: submission.lotSize,
          result: submission.result,
          profitLoss: submission.profitLoss,
          grade: submission.grade || null,
          feedback: submission.feedback || null,
          submittedAt: submission.createdAt,
          reviewedAt: submission.reviewedAt || null,
        };
      })
    );

    res.json({
      task: {
        _id: task._id.toString(),
        title: task.title,
        description: task.description,
        instructions: task.instructions,
      },
      submissions: submissionsWithDetails,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Get task submissions error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(getTaskSubmissions, ['instructor', 'admin']);


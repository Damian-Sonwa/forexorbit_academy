import { unexpectedBody } from '@/lib/public-error';
/**
 * Get Submissions for a Specific Task API Route
 * GET: Get all student submissions for a specific demo task
 * Only accessible to instructors and admins
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isStoredId } from '@/lib/account-access';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { findByIds, objectIdsFrom } from '@/lib/batch-lookup';

async function getTaskSubmissions(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    // Only instructors and admins can view submissions
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can view submissions' });
    }

    const { id } = req.query;
    if (!isStoredId(id)) {
      return res.status(400).json({ error: 'Task ID is required' });
    }

    const db = await getDb();
    const submissions = db.collection('demoTaskSubmissions');
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
    const submissionDocs = await submissions
      .find({ taskId: id })
      .sort({ submittedAt: -1 })
      .toArray();

    // Student details in one query, not one per submission.
    const students = await findByIds(users, objectIdsFrom(submissionDocs.map((s) => s.studentId)), { name: 1, email: 1 });
    const submissionsWithDetails = submissionDocs.map((submission) => {
        const student = students.get(String(submission.studentId));
        return {
          _id: submission._id.toString(),
          studentId: submission.studentId,
          studentName: student?.name || 'Unknown Student',
          studentEmail: student?.email || 'Unknown Email',
          taskId: submission.taskId,
          reasoning: submission.reasoning || '',
          screenshotUrls: submission.screenshotUrls || [],
          grade: submission.grade || null,
          feedback: submission.feedback || null,
          submittedAt: submission.submittedAt || submission.createdAt,
          reviewedAt: submission.reviewedAt || null,
        };
      });

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
    console.error('Get task submissions error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(getTaskSubmissions, ['instructor', 'admin']);


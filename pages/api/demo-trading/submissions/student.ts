/**
 * Student Demo Task Submissions API Route
 * GET: Get student's own submissions (optionally filtered by taskId)
 * Only accessible to students
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getStudentSubmissions(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can view their own submissions
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can view their own submissions' });
    }

    const { taskId } = req.query;
    const db = await getDb();
    const submissions = db.collection('demoTaskSubmissions');
    const tasks = db.collection('demoTasks');

    // Build query - only this student's submissions
    const query: Record<string, unknown> = {
      studentId: req.user!.userId,
    };

    // Optionally filter by taskId
    if (taskId && typeof taskId === 'string') {
      query.taskId = taskId;
    }

    const submissionDocs = await submissions
      .find(query)
      .sort({ submittedAt: -1 })
      .toArray();

    // Populate task details
    const submissionsWithDetails = await Promise.all(
      submissionDocs.map(async (submission) => {
        const task = submission.taskId
          ? await tasks.findOne(
              { _id: new ObjectId(submission.taskId) },
              { projection: { title: 1, description: 1 } }
            )
          : null;

        return {
          _id: submission._id.toString(),
          taskId: submission.taskId,
          taskTitle: task?.title || 'Unknown Task',
          taskDescription: task?.description || '',
          reasoning: submission.reasoning || '',
          screenshotUrls: submission.screenshotUrls || [],
          grade: submission.grade || null,
          feedback: submission.feedback || null,
          reviewedAt: submission.reviewedAt || null,
          submittedAt: submission.submittedAt || submission.createdAt,
          createdAt: submission.createdAt,
        };
      })
    );

    res.json(submissionsWithDetails);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Get student submissions error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(getStudentSubmissions, ['student']);


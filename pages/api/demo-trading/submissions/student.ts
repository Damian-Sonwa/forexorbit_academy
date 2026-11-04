import { unexpectedBody } from '@/lib/public-error';
/**
 * Student Demo Task Submissions API Route
 * GET: Get student's own submissions (optionally filtered by taskId)
 * Only accessible to students
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { findByIds, objectIdsFrom } from '@/lib/batch-lookup';

async function getStudentSubmissions(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
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

    // Task details in one query, not one per submission.
    const taskRows = await findByIds(tasks, objectIdsFrom(submissionDocs.map((s) => s.taskId)), { title: 1, description: 1 });
    const submissionsWithDetails = submissionDocs.map((submission) => {
        const task = taskRows.get(String(submission.taskId));
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
      });

    res.json(submissionsWithDetails);
  } catch (error: unknown) {
    console.error('Get student submissions error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(getStudentSubmissions, ['student']);


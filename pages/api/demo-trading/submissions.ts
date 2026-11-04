import { unexpectedBody } from '@/lib/public-error';
/**
 * Demo Trading Submissions API Route
 * GET: Get student demo task submissions for instructor
 * Only accessible to instructors and admins
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { listPage } from '@/lib/practice-desk';
import { getDb } from '@/lib/mongodb';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { findByIds, objectIdsFrom } from '@/lib/batch-lookup';

async function getSubmissions(req: AuthRequest, res: NextApiResponse) {
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

    const db = await getDb();
    const submissions = db.collection('demoTaskSubmissions');
    const users = db.collection('users');
    const tasks = db.collection('demoTasks');

    // For instructors, filter by instructorId
    // For admins, show all submissions
    const query: Record<string, unknown> = {};

    if (req.user!.role === 'instructor') {
      query.instructorId = req.user!.userId;
    }

    const submissionDocs = await submissions
      .find(query)
      .sort({ submittedAt: -1 })
      .skip(listPage(req.query).skip)
      .limit(listPage(req.query).limit)
      .toArray();

    // Student and task details in two queries, not two per submission.
    const [students, taskRows] = await Promise.all([
      findByIds(users, objectIdsFrom(submissionDocs.map((s) => s.studentId)), { name: 1, email: 1 }),
      findByIds(tasks, objectIdsFrom(submissionDocs.map((s) => s.taskId)), { title: 1, description: 1 }),
    ]);
    const submissionsWithDetails = submissionDocs.map((submission) => {
        const student = students.get(String(submission.studentId));
        const task = taskRows.get(String(submission.taskId));
        return {
          _id: submission._id.toString(),
          studentId: submission.studentId,
          studentName: student?.name || 'Unknown Student',
          studentEmail: student?.email || 'Unknown Email',
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
          updatedAt: submission.updatedAt,
        };
      });

    res.json(submissionsWithDetails);
  } catch (error: unknown) {
    console.error('Get submissions error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(getSubmissions, ['instructor', 'admin']);


/**
 * Demo Trading Submissions API Route
 * GET: Get student demo task submissions for instructor
 * Only accessible to instructors and admins
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getSubmissions(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can view submissions
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Only instructors and admins can view submissions' });
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
      .toArray();

    // Populate student and task details
    const submissionsWithDetails = await Promise.all(
      submissionDocs.map(async (submission) => {
        const [student, task] = await Promise.all([
          users.findOne(
            { _id: new ObjectId(submission.studentId) },
            { projection: { name: 1, email: 1 } }
          ),
          submission.taskId
            ? tasks.findOne(
                { _id: new ObjectId(submission.taskId) },
                { projection: { title: 1, description: 1 } }
              )
            : null,
        ]);

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
      })
    );

    res.json(submissionsWithDetails);
  } catch (error: unknown) {
    console.error('Get submissions error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(getSubmissions, ['instructor', 'admin']);


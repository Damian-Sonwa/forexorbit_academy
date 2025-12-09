/**
 * Assignment Submission API Route
 * POST: Submit assignment (students only)
 * GET: Get submission details
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function submitAssignment(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Students only' });
    }

    const { id } = req.query;
    const { submissionText, submissionFile } = req.body;
    const userId = req.user!.userId;

    if (!submissionText && !submissionFile) {
      return res.status(400).json({ error: 'Submission text or file required' });
    }

    const db = await getDb();
    const assignments = db.collection('assignments');
    const submissions = db.collection('assignmentSubmissions');
    const users = db.collection('users');

    // Check if assignment exists
    const assignment = await assignments.findOne({ _id: new ObjectId(id as string) });
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Check if already submitted
    const existing = await submissions.findOne({
      userId,
      assignmentId: id as string,
    });

    if (existing) {
      // Update existing submission
      await submissions.updateOne(
        { userId, assignmentId: id as string },
        {
          $set: {
            submissionText,
            submissionFile,
            submittedAt: new Date(),
            status: 'submitted',
            updatedAt: new Date(),
          },
        }
      );
    } else {
      // Create new submission
      await submissions.insertOne({
        userId,
        assignmentId: id as string,
        courseId: assignment.courseId,
        lessonId: assignment.lessonId,
        submissionText,
        submissionFile,
        status: 'submitted',
        grade: null,
        feedback: null,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Award points for submission
      await users.updateOne(
        { _id: new ObjectId(userId) },
        { $inc: { points: assignment.points || 0 } }
      );
    }

    res.json({ success: true, message: 'Assignment submitted successfully' });
  } catch (error: any) {
    console.error('Submit assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getSubmission(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const userId = req.user!.userId;
    const db = await getDb();
    const submissions = db.collection('assignmentSubmissions');

    const submission = await submissions.findOne({
      userId,
      assignmentId: id as string,
    });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.json(submission);
  } catch (error: any) {
    console.error('Get submission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return submitAssignment(req, res);
  } else if (req.method === 'GET') {
    return getSubmission(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);













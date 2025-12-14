/**
 * Assignment Grading API Route (Instructor/Admin Only)
 * POST: Grade assignment submission
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function gradeAssignment(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Instructor/Admin only' });
    }

    const { id } = req.query;
    const { submissionId, grade, feedback } = req.body;

    if (!submissionId || grade === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const submissions = db.collection('assignmentSubmissions');
    const users = db.collection('users');
    const assignments = db.collection('assignments');

    // Get submission
    const submission = await submissions.findOne({ _id: new ObjectId(submissionId) });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Update submission with grade and feedback
    await submissions.updateOne(
      { _id: new ObjectId(submissionId) },
      {
        $set: {
          grade: parseFloat(grade),
          feedback,
          gradedBy: req.user!.userId,
          gradedAt: new Date(),
          status: 'graded',
          updatedAt: new Date(),
        },
      }
    );

    // Award points based on grade percentage
    const assignment = await assignments.findOne({ _id: new ObjectId(id as string) });
    if (assignment && assignment.points) {
      const pointsEarned = Math.round((parseFloat(grade) / 100) * assignment.points);
      await users.updateOne(
        { _id: new ObjectId(submission.userId) },
        { $inc: { points: pointsEarned } }
      );
    }

    res.json({ success: true, message: 'Assignment graded successfully' });
  } catch (error: any) {
    console.error('Grade assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(gradeAssignment, ['instructor', 'admin']);


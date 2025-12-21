/**
 * Task Submission API Route (Single Submission)
 * DELETE: Delete task submission (only if not reviewed yet)
 * Only accessible to students for their own submissions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function deleteSubmission(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can delete their own submissions
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can delete their submissions' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Submission ID is required' });
    }

    const db = await getDb();
    const submissions = db.collection('demoTaskSubmissions');

    // Verify submission exists and belongs to the student
    const submission = await submissions.findOne({ _id: new ObjectId(id) });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only delete your own submissions' });
    }

    // Only allow deletion if not reviewed yet
    if (submission.reviewedAt || submission.grade !== null) {
      return res.status(400).json({ error: 'Cannot delete a submission that has been reviewed' });
    }

    await submissions.deleteOne({ _id: new ObjectId(id) });

    res.json({ success: true, message: 'Submission deleted successfully' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Delete submission error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'DELETE') {
    return deleteSubmission(req, res);
  } else {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
}, ['student']);


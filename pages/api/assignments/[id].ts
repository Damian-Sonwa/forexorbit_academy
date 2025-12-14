/**
 * Assignment API Route (Single Assignment)
 * GET: Get assignment details
 * PUT: Update assignment (instructor/admin)
 * DELETE: Delete assignment (instructor/admin)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getAssignment(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const assignments = db.collection('assignments');
    const submissions = db.collection('assignmentSubmissions');

    const assignment = await assignments.findOne({ _id: new ObjectId(id as string) });
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // For students, include their submission
    if (req.user!.role === 'student') {
      const submission = await submissions.findOne({
        userId: req.user!.userId,
        assignmentId: id as string,
      });
      assignment.submission = submission || null;
    }

    // For instructors/admins, include all submissions
    if (req.user!.role === 'instructor' || req.user!.role === 'admin') {
      const allSubmissions = await submissions.find({ assignmentId: id as string }).toArray();
      assignment.submissions = allSubmissions;
    }

    res.json(assignment);
  } catch (error: any) {
    console.error('Get assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateAssignment(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Instructor/Admin only' });
    }

    const { id } = req.query;
    const db = await getDb();
    const assignments = db.collection('assignments');

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (req.body.title) updateData.title = req.body.title;
    if (req.body.description !== undefined) updateData.description = req.body.description;
    if (req.body.instructions) updateData.instructions = req.body.instructions;
    if (req.body.dueDate) updateData.dueDate = new Date(req.body.dueDate);
    if (req.body.points) updateData.points = req.body.points;

    await assignments.updateOne(
      { _id: new ObjectId(id as string) },
      { $set: updateData }
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteAssignment(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Instructor/Admin only' });
    }

    const { id } = req.query;
    const db = await getDb();
    const assignments = db.collection('assignments');
    const submissions = db.collection('assignmentSubmissions');

    // Delete assignment and all submissions
    await assignments.deleteOne({ _id: new ObjectId(id as string) });
    await submissions.deleteMany({ assignmentId: id as string });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getAssignment(req, res);
  } else if (req.method === 'PUT') {
    return updateAssignment(req, res);
  } else if (req.method === 'DELETE') {
    return deleteAssignment(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


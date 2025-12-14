/**
 * Assignments API Route
 * GET: List assignments for a course/lesson
 * POST: Create assignment (instructor/admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getAssignments(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId, lessonId } = req.query;
    const db = await getDb();
    const assignments = db.collection('assignments');

    let query: any = {};
    if (courseId) query.courseId = courseId;
    if (lessonId) query.lessonId = lessonId;

    const assignmentsList = await assignments.find(query).sort({ dueDate: 1 }).toArray();

    // For students, include submission status
    if (req.user!.role === 'student') {
      const submissions = db.collection('assignmentSubmissions');
      const userId = req.user!.userId;

      const enrichedAssignments = await Promise.all(
        assignmentsList.map(async (assignment) => {
          const submission = await submissions.findOne({
            userId,
            assignmentId: assignment._id.toString(),
          });

          return {
            ...assignment,
            submitted: !!submission,
            submission: submission || null,
          };
        })
      );

      return res.json(enrichedAssignments);
    }

    res.json(assignmentsList);
  } catch (error: any) {
    console.error('Get assignments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createAssignment(req: AuthRequest, res: NextApiResponse) {
  try {
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Instructor/Admin only' });
    }

    const { courseId, lessonId, title, description, instructions, dueDate, points, type } = req.body;

    if (!courseId || !title || !instructions) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const assignments = db.collection('assignments');

    const result = await assignments.insertOne({
      courseId,
      lessonId: lessonId || null,
      title,
      description: description || '',
      instructions,
      dueDate: dueDate ? new Date(dueDate) : null,
      points: points || 100,
      type: type || 'assignment', // 'assignment' or 'project'
      createdBy: req.user!.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      ...req.body,
    });
  } catch (error: any) {
    console.error('Create assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getAssignments(req, res);
  } else if (req.method === 'POST') {
    return createAssignment(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


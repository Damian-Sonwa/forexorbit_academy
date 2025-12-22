/**
 * Review Demo Task Submission API Route
 * PUT: Add grade and feedback to a submission
 * Only accessible to instructors and admins
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createNotification } from '@/lib/notifications';

async function reviewSubmission(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can review submissions
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can review submissions' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Submission ID is required' });
    }

    const { grade, feedback } = req.body;

    if (grade === undefined && !feedback) {
      return res.status(400).json({ error: 'Grade or feedback is required' });
    }

    // Validate grade if provided (0-100 or letter grade)
    if (grade !== undefined && grade !== null) {
      if (typeof grade === 'number' && (grade < 0 || grade > 100)) {
        return res.status(400).json({ error: 'Grade must be between 0 and 100' });
      }
    }

    const db = await getDb();
    const submissions = db.collection('demoTaskSubmissions');
    const tasks = db.collection('demoTasks');

    // Get submission
    const submission = await submissions.findOne({ _id: new ObjectId(id) });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Verify task exists and instructor has permission
    if (submission.taskId) {
      const task = await tasks.findOne({ _id: new ObjectId(submission.taskId) });
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // For instructors, verify they created this task
      if (req.user!.role === 'instructor' && task.assignedBy !== req.user!.userId) {
        return res.status(403).json({ error: 'You can only review submissions for your own tasks' });
      }
    }

    // Update submission with grade and feedback
    const updateData: Record<string, unknown> = {
      reviewedAt: new Date(),
      updatedAt: new Date(),
    };

    if (grade !== undefined) {
      updateData.grade = grade;
    }

    if (feedback !== undefined) {
      updateData.feedback = feedback;
    }

    await submissions.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    // Notify student about feedback
    try {
      const users = db.collection('users');
      const instructor = await users.findOne(
        { _id: new ObjectId(req.user!.userId) },
        { projection: { name: 1 } }
      );

      await createNotification({
        type: 'task_feedback',
        title: 'Task Feedback Received',
        message: `You received feedback on task: ${task?.title || 'your submission'}`,
        userId: submission.studentId,
        taskId: submission.taskId,
        relatedId: id,
        roleTarget: 'student',
        metadata: { 
          taskTitle: task?.title || 'Task',
          instructorName: instructor?.name || 'Instructor',
          grade: grade !== undefined ? grade : submission.grade,
        },
      });

      // Emit socket event
      if (req.io) {
        req.io.to(`user:${submission.studentId}`).emit('notification', {
          type: 'task_feedback',
          title: 'Task Feedback Received',
          message: `You received feedback on task: ${task?.title || 'your submission'}`,
          taskId: submission.taskId,
          read: false,
          createdAt: new Date(),
        });
      }
    } catch (notifError) {
      console.error('Failed to create feedback notification:', notifError);
      // Don't fail the request if notification creation fails
    }

    res.json({
      success: true,
      message: 'Submission reviewed successfully',
      submission: {
        _id: id,
        grade: grade !== undefined ? grade : submission.grade,
        feedback: feedback !== undefined ? feedback : submission.feedback,
        reviewedAt: updateData.reviewedAt,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Review submission error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(reviewSubmission, ['instructor', 'admin']);


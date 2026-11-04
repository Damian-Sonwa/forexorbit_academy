import { unexpectedBody } from '@/lib/public-error';
/**
 * Submit Demo Task API Route
 * POST: Submit a demo task with screenshot and reasoning
 * Only accessible to students
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { createNotification } from '@/lib/notifications';
import { isStoredId } from '@/lib/account-access';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { allowRequest, tradingLimiter } from '@/lib/content-rate-limit';
import { taskIsFor } from '@/lib/practice-desk';

async function submitTask(req: AuthRequest, res: NextApiResponse) {
  setPrivateNoStore(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    // Only students can submit tasks
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can submit tasks' });
    }

    const { id } = req.query;
    if (!isStoredId(id)) {
      return res.status(400).json({ error: 'Task ID is required' });
    }
    if (!(await allowRequest(tradingLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;

    const { reasoning, screenshotUrls } = req.body || {};
    const studentId = req.user!.userId;

    // Validate required fields
    if (!reasoning || typeof reasoning !== 'string' || reasoning.trim().length === 0) {
      return res.status(400).json({ error: 'Reasoning/analysis is required' });
    }

    const db = await getDb();
    const tasks = db.collection('demoTasks');
    const submissions = db.collection('demoTaskSubmissions');

    // Verify task exists
    const task = await tasks.findOne({ _id: new ObjectId(id) });
    if (!task || !taskIsFor(task, studentId)) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if student already submitted this task
    const existingSubmission = await submissions.findOne({
      studentId,
      taskId: id,
    });

    if (existingSubmission) {
      // Update existing submission
      await submissions.updateOne(
        { _id: existingSubmission._id },
        {
          $set: {
            reasoning: reasoning.trim(),
            screenshotUrls: Array.isArray(screenshotUrls) ? screenshotUrls : (screenshotUrls ? [screenshotUrls] : []),
            submittedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      return res.json({ 
        success: true, 
        message: 'Task submission updated successfully',
        submissionId: existingSubmission._id.toString(),
      });
    } else {
      // Create new submission
      const result = await submissions.insertOne({
        studentId,
        taskId: id,
        instructorId: task.assignedBy, // Store instructor ID for filtering
        reasoning: reasoning.trim(),
        screenshotUrls: Array.isArray(screenshotUrls) ? screenshotUrls : (screenshotUrls ? [screenshotUrls] : []),
        grade: null,
        feedback: null,
        reviewedAt: null,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const submissionId = result.insertedId.toString();

      // Notify instructor about new submission
      if (task.assignedBy) {
        try {
          const users = db.collection('users');
          const student = await users.findOne(
            { _id: new ObjectId(studentId) },
            { projection: { name: 1 } }
          );

          await createNotification({
            type: 'task_submission',
            title: 'New Task Submission',
            message: `${student?.name || 'A student'} submitted task: ${task.title}`,
            userId: task.assignedBy,
            taskId: id,
            relatedId: submissionId,
            roleTarget: 'instructor',
            metadata: { 
              taskTitle: task.title,
              studentName: student?.name || 'Unknown',
              studentId,
            },
          });

          // Emit socket event
          if (req.io) {
            req.io.to(`user:${task.assignedBy}`).emit('notification', {
              type: 'task_submission',
              title: 'New Task Submission',
              message: `${student?.name || 'A student'} submitted task: ${task.title}`,
              taskId: id,
              read: false,
              createdAt: new Date(),
            });
          }
        } catch (notifError) {
          console.error('Failed to create submission notification:', notifError);
          // Don't fail the request if notification creation fails
        }
      }

      return res.json({ 
        success: true, 
        message: 'Task submitted successfully',
        submissionId,
      });
    }
  } catch (error: unknown) {
    console.error('Submit task error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(submitTask, ['student']);


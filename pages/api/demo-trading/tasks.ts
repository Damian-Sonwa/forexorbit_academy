/**
 * Demo Trading Tasks API Route
 * GET: Get tasks for student (or all tasks for instructor)
 * POST: Create new task (instructor only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getTasks(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const tasks = db.collection('demoTasks');
    const users = db.collection('users');

    if (req.user!.role === 'student') {
      // Students see only their assigned tasks
      const taskList = await tasks
        .find({
          $or: [
            { assignedTo: req.user!.userId },
            { assignedTo: null }, // General tasks for all students
          ],
        })
        .sort({ createdAt: -1 })
        .toArray();

      // Populate assignedBy names
      const tasksWithNames = await Promise.all(
        taskList.map(async (task) => {
          if (task.assignedBy) {
            const instructor = await users.findOne(
              { _id: new ObjectId(task.assignedBy) },
              { projection: { name: 1 } }
            );
            return {
              ...task,
              _id: task._id.toString(),
              assignedByName: instructor?.name || 'Instructor',
            };
          }
          return {
            ...task,
            _id: task._id.toString(),
          };
        })
      );

      return res.json(tasksWithNames);
    } else if (req.user!.role === 'instructor' || req.user!.role === 'admin') {
      // Instructors/Admins see all tasks
      const taskList = await tasks.find({}).sort({ createdAt: -1 }).toArray();

      // Populate assignedBy and assignedTo names
      const tasksWithNames = await Promise.all(
        taskList.map(async (task) => {
          const [instructor, student] = await Promise.all([
            task.assignedBy
              ? users.findOne({ _id: new ObjectId(task.assignedBy) }, { projection: { name: 1 } })
              : null,
            task.assignedTo
              ? users.findOne({ _id: new ObjectId(task.assignedTo) }, { projection: { name: 1 } })
              : null,
          ]);

          return {
            ...task,
            _id: task._id.toString(),
            assignedByName: instructor?.name || 'Unknown',
            assignedToName: student?.name || 'All Students',
          };
        })
      );

      return res.json(tasksWithNames);
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch (error: any) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function createTask(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only instructors and admins can create tasks
    if (req.user!.role !== 'instructor' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only instructors and admins can create tasks' });
    }

    const { title, description, instructions, assignedTo, dueDate } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const db = await getDb();
    const tasks = db.collection('demoTasks');

    const task = {
      title,
      description,
      instructions: instructions || '',
      assignedBy: req.user!.userId,
      assignedTo: assignedTo || null, // null means assigned to all students
      dueDate: dueDate ? new Date(dueDate) : null,
      completed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await tasks.insertOne(task);

    res.status(201).json({
      _id: result.insertedId.toString(),
      ...task,
    });
  } catch (error: any) {
    console.error('Create task error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getTasks(req, res);
  } else if (req.method === 'POST') {
    return createTask(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});


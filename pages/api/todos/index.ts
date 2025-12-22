/**
 * To-Do List API Route
 * GET: Get user's to-do items
 * POST: Create to-do item
 * PUT: Update to-do item
 * DELETE: Delete to-do item
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export interface TodoItem {
  _id?: string;
  userId: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed';
  priority?: 'low' | 'medium' | 'high';
  relatedType?: 'task' | 'live_class' | 'reminder' | 'consultation' | null;
  relatedId?: string;
  dueDate?: Date;
  reminderAt?: Date | null;
  reminderTriggered?: boolean;
  completedAt?: Date;
  createdAt: Date;
  metadata?: Record<string, any>;
}

async function getTodos(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const todos = db.collection('todos');

    const query: any = { userId: req.user!.userId };
    
    // Optional filters
    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.relatedType) {
      query.relatedType = req.query.relatedType;
    }

    if (req.query.relatedId) {
      query.relatedId = req.query.relatedId;
    }

    const todoDocs = await todos
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    const result = todoDocs.map((todo) => ({
      _id: todo._id.toString(),
      userId: todo.userId,
      title: todo.title,
      description: todo.description,
      status: todo.status || 'pending',
      priority: todo.priority || 'medium',
      relatedType: todo.relatedType || null,
      relatedId: todo.relatedId,
      dueDate: todo.dueDate,
      reminderAt: todo.reminderAt || null,
      reminderTriggered: todo.reminderTriggered || false,
      completedAt: todo.completedAt,
      createdAt: todo.createdAt,
      metadata: todo.metadata || {},
    }));

    res.json({ todos: result });
  } catch (error: unknown) {
    console.error('Get todos error:', error);
    res.status(500).json({ error: 'Failed to fetch todos', message: error instanceof Error ? error.message : 'Internal server error' });
  }
}

async function createTodo(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const todos = db.collection('todos');

    const {
      title,
      description,
      priority,
      relatedType,
      relatedId,
      dueDate,
      reminderAt,
      metadata,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const todo: Omit<TodoItem, '_id'> = {
      userId: req.user!.userId,
      title,
      description: description || undefined,
      status: 'pending',
      priority: priority || 'medium',
      relatedType: relatedType || null,
      relatedId: relatedId || undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      reminderAt: reminderAt ? new Date(reminderAt) : null,
      reminderTriggered: false,
      createdAt: new Date(),
      metadata: metadata || {},
    };

    const result = await todos.insertOne(todo);

    // Emit socket event for real-time update
    if (req.io) {
      req.io.to(`user:${req.user!.userId}`).emit('todo_created', {
        ...todo,
        _id: result.insertedId.toString(),
      });
    }

    res.status(201).json({
      success: true,
      todo: {
        ...todo,
        _id: result.insertedId.toString(),
      },
    });
  } catch (error: unknown) {
    console.error('Create todo error:', error);
    res.status(500).json({ error: 'Failed to create todo', message: error instanceof Error ? error.message : 'Internal server error' });
  }
}

async function updateTodo(req: AuthRequest, res: NextApiResponse) {
  try {
    const { todoId } = req.query;
    const updates = req.body;

    if (!todoId || typeof todoId !== 'string') {
      return res.status(400).json({ error: 'Todo ID is required' });
    }

    const db = await getDb();
    const todos = db.collection('todos');

    // Verify todo belongs to user
    const todo = await todos.findOne({
      _id: new ObjectId(todoId),
      userId: req.user!.userId,
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found or unauthorized' });
    }

    // Build update object
    const updateData: any = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.status !== undefined) {
      updateData.status = updates.status;
      if (updates.status === 'completed' && !todo.completedAt) {
        updateData.completedAt = new Date();
        // Clear reminder when task is completed
        if (todo.reminderAt) {
          updateData.reminderAt = null;
          updateData.reminderTriggered = false;
        }
      } else if (updates.status === 'pending' && todo.completedAt) {
        updateData.completedAt = null;
      }
    }
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.dueDate !== undefined) {
      updateData.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
    }
    if (updates.reminderAt !== undefined) {
      updateData.reminderAt = updates.reminderAt ? new Date(updates.reminderAt) : null;
      // Reset reminderTriggered when reminder time is changed
      if (updates.reminderAt) {
        updateData.reminderTriggered = false;
      }
    }
    if (updates.reminderTriggered !== undefined) updateData.reminderTriggered = updates.reminderTriggered;
    if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

    await todos.updateOne(
      { _id: new ObjectId(todoId) },
      { $set: updateData }
    );

    // Emit socket event for real-time update
    if (req.io) {
      req.io.to(`user:${req.user!.userId}`).emit('todo_updated', {
        _id: todoId,
        ...updateData,
      });
    }

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Update todo error:', error);
    res.status(500).json({ error: 'Failed to update todo', message: error instanceof Error ? error.message : 'Internal server error' });
  }
}

async function deleteTodo(req: AuthRequest, res: NextApiResponse) {
  try {
    const { todoId } = req.query;

    if (!todoId || typeof todoId !== 'string') {
      return res.status(400).json({ error: 'Todo ID is required' });
    }

    const db = await getDb();
    const todos = db.collection('todos');

    // Verify todo belongs to user
    const todo = await todos.findOne({
      _id: new ObjectId(todoId),
      userId: req.user!.userId,
    });

    if (!todo) {
      return res.status(404).json({ error: 'Todo not found or unauthorized' });
    }

    await todos.deleteOne({ _id: new ObjectId(todoId) });

    // Emit socket event for real-time update
    if (req.io) {
      req.io.to(`user:${req.user!.userId}`).emit('todo_deleted', { _id: todoId });
    }

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Delete todo error:', error);
    res.status(500).json({ error: 'Failed to delete todo', message: error instanceof Error ? error.message : 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getTodos(req, res);
    case 'POST':
      return createTodo(req, res);
    case 'PUT':
      return updateTodo(req, res);
    case 'DELETE':
      return deleteTodo(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


/**
 * Trade Journal API Route
 * GET: Get trade journal entries for student
 * POST: Create new trade journal entry
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getJournal(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access their journal
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can access trade journal' });
    }

    const db = await getDb();
    const journal = db.collection('demoTradeJournal');
    const tasks = db.collection('demoTasks');

    const entries = await journal
      .find({ studentId: req.user!.userId })
      .sort({ createdAt: -1 })
      .toArray();

    // Populate task titles if taskId exists
    const entriesWithTasks = await Promise.all(
      entries.map(async (entry) => {
        if (entry.taskId) {
          const task = await tasks.findOne(
            { _id: new ObjectId(entry.taskId) },
            { projection: { title: 1 } }
          );
          return {
            ...entry,
            _id: entry._id.toString(),
            taskTitle: task?.title || 'Unknown Task',
          };
        }
        return {
          ...entry,
          _id: entry._id.toString(),
        };
      })
    );

    res.json(entriesWithTasks);
  } catch (error: any) {
    console.error('Get journal error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function createJournalEntry(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can create journal entries
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can create journal entries' });
    }

    const {
      pair,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      lotSize,
      result,
      profitLoss,
      notes,
      taskId,
      screenshot,
    } = req.body;

    // Validation
    if (!pair || !direction || !entryPrice || !stopLoss || !takeProfit || !lotSize || !result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['buy', 'sell'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction. Must be "buy" or "sell"' });
    }

    if (!['win', 'loss', 'breakeven', 'open'].includes(result)) {
      return res.status(400).json({ error: 'Invalid result. Must be "win", "loss", "breakeven", or "open"' });
    }

    // If result is not "open", profitLoss should be provided
    if (result !== 'open' && profitLoss === undefined) {
      return res.status(400).json({ error: 'Profit/Loss is required for closed trades' });
    }

    const db = await getDb();
    const journal = db.collection('demoTradeJournal');

    // If taskId is provided, verify it exists and is assigned to the student
    if (taskId) {
      const tasks = db.collection('demoTasks');
      const task = await tasks.findOne({
        _id: new ObjectId(taskId),
        $or: [
          { assignedTo: req.user!.userId },
          { assignedTo: null },
        ],
      });

      if (!task) {
        return res.status(404).json({ error: 'Task not found or not assigned to you' });
      }
    }

    const entry = {
      studentId: req.user!.userId,
      pair: pair.toUpperCase(),
      direction,
      entryPrice: parseFloat(entryPrice),
      stopLoss: parseFloat(stopLoss),
      takeProfit: parseFloat(takeProfit),
      lotSize: parseFloat(lotSize),
      result,
      profitLoss: profitLoss !== undefined ? parseFloat(profitLoss) : undefined,
      notes: notes || '',
      taskId: taskId || null,
      screenshot: screenshot || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertResult = await journal.insertOne(entry);

    res.status(201).json({
      _id: insertResult.insertedId.toString(),
      ...entry,
    });
  } catch (error: any) {
    console.error('Create journal entry error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getJournal(req, res);
  } else if (req.method === 'POST') {
    return createJournalEntry(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}, ['student']);


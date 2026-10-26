/**
 * Trade Journal API Route
 * GET: Get trade journal entries for student
 * POST: Create new trade journal entry
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { analyzeTrade, isAIConfigured } from '@/lib/ai';

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

    // Populate task titles if taskId exists, and include grade/feedback
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
            grade: entry.grade || null,
            feedback: entry.feedback || null,
            reviewedAt: entry.reviewedAt || null,
            aiFeedback: entry.aiFeedback || null,
          };
        }
        return {
          ...entry,
          _id: entry._id.toString(),
          grade: entry.grade || null,
          feedback: entry.feedback || null,
          reviewedAt: entry.reviewedAt || null,
          aiFeedback: entry.aiFeedback || null,
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

    // Prevent duplicate submissions by checking for identical entry within last 5 seconds
    const db = await getDb();
    const journal = db.collection('demoTradeJournal');
    
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const duplicateCheck = await journal.findOne({
      studentId: req.user!.userId,
      pair: pair?.toUpperCase(),
      entryPrice: parseFloat(entryPrice),
      direction,
      createdAt: { $gte: fiveSecondsAgo },
    });

    if (duplicateCheck) {
      return res.status(409).json({ error: 'Duplicate entry detected. Please wait a moment before submitting again.' });
    }

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

    // If taskId is provided, verify it exists and is assigned to the student
    let instructorId = null;
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

      // Get instructorId from the task (assignedBy field)
      instructorId = task.assignedBy || null;
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
      instructorId: instructorId, // Save instructorId for filtering in instructor dashboard
      screenshot: screenshot || null, // Store Cloudinary URL directly
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertResult = await journal.insertOne(entry);

    // Generate AI feedback if AI is configured (non-blocking)
    let aiFeedback = null;
    if (isAIConfigured()) {
      try {
        const analysis = await analyzeTrade(
          {
            pair: entry.pair,
            direction: entry.direction,
            entryPrice: entry.entryPrice,
            stopLoss: entry.stopLoss,
            takeProfit: entry.takeProfit,
            lotSize: entry.lotSize,
            notes: entry.notes,
          },
          req.user!.userId
        );

        // Store AI feedback in the entry
        await journal.updateOne(
          { _id: insertResult.insertedId },
          { $set: { aiFeedback: analysis } }
        );

        aiFeedback = analysis;
      } catch (aiError) {
        // Log but don't fail the request if AI fails
        console.error('AI feedback generation failed:', aiError);
      }
    }

    // Return the created entry with proper formatting
    const createdEntry = {
      _id: insertResult.insertedId.toString(),
      ...entry,
      aiFeedback,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };

    res.status(201).json(createdEntry);
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


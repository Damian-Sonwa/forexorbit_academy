import { unexpectedBody } from '@/lib/public-error';
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
import { findByIds, objectIdsFrom } from '@/lib/batch-lookup';
import { isStoredId } from '@/lib/account-access';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { allowRequest, tradingLimiter } from '@/lib/content-rate-limit';
import { listPage } from '@/lib/practice-desk';
import { readJournalEntry, taskIsFor } from '@/lib/practice-desk';

async function getJournal(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can access their journal
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can access trade journal' });
    }

    const db = await getDb();
    const journal = db.collection('demoTradeJournal');
    const tasks = db.collection('demoTasks');

    const paging = listPage(req.query);
    const entries = await journal
      .find({ studentId: req.user!.userId })
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .toArray();

    // Populate task titles (one demoTasks query for all entries). Grades belong to submissions/feedback
    const taskTitles = await findByIds(tasks, objectIdsFrom(entries.map((entry) => entry.taskId)), { title: 1 });
    const entriesWithTasks = entries.map((stored) => {
      const entry = { ...stored };
      for (const field of ['grade', 'feedback', 'reviewedAt']) delete entry[field];
      if (entry.taskId) {
        const task = taskTitles.get(String(entry.taskId));
        return {
          ...entry,
          _id: entry._id.toString(),
          taskTitle: task?.title || 'Unknown Task',
          aiFeedback: entry.aiFeedback || null,
        };
      }
      return {
        ...entry,
        _id: entry._id.toString(),
        aiFeedback: entry.aiFeedback || null,
      };
    });

    res.json(entriesWithTasks);
  } catch (error: any) {
    console.error('Get journal error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function createJournalEntry(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can create journal entries
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can create journal entries' });
    }

    const checked = readJournalEntry(req.body);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const { pair, direction, entryPrice, stopLoss, takeProfit, lotSize, result, profitLoss, notes, screenshot } = checked.fields;
    const taskId = req.body?.taskId;
    if (taskId !== undefined && taskId !== null && taskId !== '' && !isStoredId(taskId)) {
      return res.status(400).json({ error: 'Invalid task' });
    }

    // Prevent duplicate submissions by checking for identical entry within last 5 seconds
    const db = await getDb();
    if (!(await allowRequest(tradingLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;
    const journal = db.collection('demoTradeJournal');
    
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const duplicateCheck = await journal.findOne({
      studentId: req.user!.userId,
      pair,
      entryPrice,
      direction,
      createdAt: { $gte: fiveSecondsAgo },
    });

    if (duplicateCheck) {
      return res.status(409).json({ error: 'Duplicate entry detected. Please wait a moment before submitting again.' });
    }

    // If taskId is provided, verify it exists and is assigned to the student
    let instructorId = null;
    if (taskId) {
      const tasks = db.collection('demoTasks');
      const task = await tasks.findOne({ _id: new ObjectId(taskId) });

      if (!task || !taskIsFor(task, req.user!.userId)) {
        return res.status(404).json({ error: 'Task not found or not assigned to you' });
      }

      // Get instructorId from the task (assignedBy field)
      instructorId = task.assignedBy || null;
    }

    const entry = {
      studentId: req.user!.userId,
      pair,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      lotSize,
      result,
      profitLoss,
      selfReported: true, // The student's own notes, not a simulator record.
      notes,
      taskId: taskId || null,
      instructorId: instructorId, // Save instructorId for filtering in instructor dashboard
      screenshot, // Store Cloudinary URL directly
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
    console.error('Create journal entry error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  setPrivateNoStore(res);
  if (req.method === 'GET') {
    return getJournal(req, res);
  } else if (req.method === 'POST') {
    return createJournalEntry(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}, ['student']);


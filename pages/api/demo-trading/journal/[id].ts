/**
 * Trade Journal Entry API Route (Single Entry)
 * PUT: Update trade journal entry
 * DELETE: Delete trade journal entry
 * Only accessible to students for their own entries
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function updateJournalEntry(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can update their own journal entries
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can update journal entries' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Entry ID is required' });
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
      screenshot,
    } = req.body;

    const db = await getDb();
    const journal = db.collection('demoTradeJournal');

    // Verify entry exists and belongs to the student
    const entry = await journal.findOne({ _id: new ObjectId(id) });
    if (!entry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    if (entry.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only update your own journal entries' });
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

    const updateData = {
      pair: pair.toUpperCase(),
      direction,
      entryPrice: parseFloat(entryPrice),
      stopLoss: parseFloat(stopLoss),
      takeProfit: parseFloat(takeProfit),
      lotSize: parseFloat(lotSize),
      result,
      profitLoss: profitLoss !== undefined ? parseFloat(profitLoss) : undefined,
      notes: notes || '',
      screenshot: screenshot || null,
      updatedAt: new Date(),
    };

    await journal.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    const updatedEntry = await journal.findOne({ _id: new ObjectId(id) });

    res.json({
      ...updatedEntry,
      _id: updatedEntry!._id.toString(),
      createdAt: updatedEntry!.createdAt.toISOString(),
      updatedAt: updatedEntry!.updatedAt.toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Update journal entry error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

async function deleteJournalEntry(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can delete their own journal entries
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can delete journal entries' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Entry ID is required' });
    }

    const db = await getDb();
    const journal = db.collection('demoTradeJournal');

    // Verify entry exists and belongs to the student
    const entry = await journal.findOne({ _id: new ObjectId(id) });
    if (!entry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    if (entry.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only delete your own journal entries' });
    }

    await journal.deleteOne({ _id: new ObjectId(id) });

    res.json({ success: true, message: 'Journal entry deleted successfully' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Delete journal entry error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'PUT') {
    return updateJournalEntry(req, res);
  } else if (req.method === 'DELETE') {
    return deleteJournalEntry(req, res);
  } else {
    res.setHeader('Allow', ['PUT', 'DELETE']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
}, ['student']);


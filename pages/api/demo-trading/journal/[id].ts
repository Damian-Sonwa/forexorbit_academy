import { unexpectedBody } from '@/lib/public-error';
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
import { isStoredId } from '@/lib/account-access';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { allowRequest, tradingLimiter } from '@/lib/content-rate-limit';
import { readJournalEntry } from '@/lib/practice-desk';

async function updateJournalEntry(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can update their own journal entries
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can update journal entries' });
    }

    const { id } = req.query;
    if (!isStoredId(id)) {
      return res.status(400).json({ error: 'Entry ID is required' });
    }

    const db = await getDb();
    if (!(await allowRequest(tradingLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;
    const journal = db.collection('demoTradeJournal');

    // Verify entry exists and belongs to the student
    const entry = await journal.findOne({ _id: new ObjectId(id) });
    if (!entry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    if (entry.studentId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only update your own journal entries' });
    }

    const checked = readJournalEntry(req.body);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const updateData = { ...checked.fields, selfReported: true, updatedAt: new Date() };

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
    console.error('Update journal entry error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

async function deleteJournalEntry(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only students can delete their own journal entries
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: 'Only students can delete journal entries' });
    }

    const { id } = req.query;
    if (!isStoredId(id)) {
      return res.status(400).json({ error: 'Entry ID is required' });
    }

    const db = await getDb();
    if (!(await allowRequest(tradingLimiter, { userId: req.user!.userId, res, getDb }))) return undefined;
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
    console.error('Delete journal entry error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  setPrivateNoStore(res);
  if (req.method === 'PUT') {
    return updateJournalEntry(req, res);
  } else if (req.method === 'DELETE') {
    return deleteJournalEntry(req, res);
  } else {
    res.setHeader('Allow', ['PUT', 'DELETE']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
}, ['student']);


/**
 * Mark News as Read API Route
 * POST: Mark a news item as read by the current user
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function markNewsAsRead(req: AuthRequest, res: NextApiResponse) {
  try {
    const { newsId } = req.body;
    const userId = req.user!.userId;

    if (!newsId) {
      return res.status(400).json({ error: 'News ID is required' });
    }

    const db = await getDb();
    const news = db.collection('communityNews');

    // Add user to readBy array if not already present
    const result = await news.updateOne(
      { _id: new ObjectId(newsId) },
      {
        $addToSet: { readBy: userId }, // $addToSet prevents duplicates
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'News item not found' });
    }

    res.json({ success: true, message: 'News marked as read' });
  } catch (error: any) {
    console.error('Mark news as read error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(markNewsAsRead);






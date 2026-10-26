/**
 * Community News API Route
 * GET: Get Forex news feed
 * POST: Create news item (Admin/Super Admin only)
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import {
  COMMUNITY_NEWS_CLIENT_ERROR,
  logCommunityNewsFailure,
  presentCommunityNews,
} from '@/lib/community-news';

async function getNews(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const news = db.collection('communityNews');
    const userId = req.user!.userId;

    const newsItems = await news
      .find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json(newsItems.map((item) => presentCommunityNews(item, userId)));
  } catch {
    logCommunityNewsFailure('communityNewsRead');
    res.status(500).json({ error: COMMUNITY_NEWS_CLIENT_ERROR });
  }
}

async function createNews(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only admin, superadmin, and instructors can create news
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin' && req.user!.role !== 'instructor') {
      return res.status(403).json({ error: 'Only admins and instructors can create news' });
    }

    const { title, description, category, content, link } = req.body;

    if (!title || !description || !category) {
      return res.status(400).json({ error: 'Title, description, and category are required' });
    }

    const db = await getDb();
    const news = db.collection('communityNews');

    const newsItem = {
      title,
      description,
      category,
      content: content || null,
      link: link || null,
      createdAt: new Date(),
      createdBy: req.user!.userId,
    };

    const result = await news.insertOne(newsItem);

    res.json({
      success: true,
      newsItem: {
        _id: result.insertedId.toString(),
        ...newsItem,
      },
    });
  } catch {
    logCommunityNewsFailure('communityNewsCreate');
    res.status(500).json({ error: COMMUNITY_NEWS_CLIENT_ERROR });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    return getNews(req, res);
  } else if (req.method === 'POST') {
    return createNews(req, res);
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});


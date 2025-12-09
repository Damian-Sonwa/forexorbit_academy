/**
 * Community News API Route
 * GET: Get Forex news feed
 * POST: Create news item (Admin/Super Admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
// import { ObjectId } from 'mongodb'; // Reserved for future use

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

    res.json(
      newsItems.map((item) => {
        const readBy = item.readBy || [];
        const isRead = readBy.includes(userId);
        
        return {
          _id: item._id.toString(),
          title: item.title,
          description: item.description,
          category: item.category,
          content: item.content || null,
          link: item.link || null,
          createdAt: item.createdAt,
          isRead, // Add read status for current user
          readBy, // Include readBy array for reference
        };
      })
    );
  } catch (error: any) {
    console.error('Get news error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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
  } catch (error: any) {
    console.error('Create news error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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


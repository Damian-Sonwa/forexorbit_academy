/**
 * Community News API Route - Edit/Delete
 * PUT: Update news item (Instructor/Admin/Super Admin only)
 * DELETE: Delete news item (Instructor/Admin/Super Admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function updateNews(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only admin and instructors can update news
    if (req.user!.role !== 'admin' && req.user!.role !== 'instructor') {
      return res.status(403).json({ error: 'Only admins and instructors can update news' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'News ID is required' });
    }

    const { title, description, category, content, link } = req.body;

    if (!title || !description || !category) {
      return res.status(400).json({ error: 'Title, description, and category are required' });
    }

    const db = await getDb();
    const news = db.collection('communityNews');

    // Check if news exists and user has permission (instructors can only edit their own)
    const existingNews = await news.findOne({ _id: new ObjectId(id) });
    if (!existingNews) {
      return res.status(404).json({ error: 'News not found' });
    }

    // Instructors can only edit their own news, but admins can edit any news
    if (req.user!.role === 'instructor' && existingNews.createdBy !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only edit your own news updates' });
    }
    // Admins and super admins can edit any news (no restriction)

    const updateData: any = {
      title,
      description,
      category,
      content: content || null,
      link: link || null,
      updatedAt: new Date(),
    };

    await news.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.json({
      success: true,
      message: 'News updated successfully',
    });
  } catch (error: any) {
    console.error('Update news error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function deleteNews(req: AuthRequest, res: NextApiResponse) {
  try {
    // Only admin and instructors can delete news
    if (req.user!.role !== 'admin' && req.user!.role !== 'instructor') {
      return res.status(403).json({ error: 'Only admins and instructors can delete news' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'News ID is required' });
    }

    const db = await getDb();
    const news = db.collection('communityNews');

    // Check if news exists and user has permission (instructors can only delete their own)
    const existingNews = await news.findOne({ _id: new ObjectId(id) });
    if (!existingNews) {
      return res.status(404).json({ error: 'News not found' });
    }

    // Instructors can only delete their own news, but admins can delete any news
    if (req.user!.role === 'instructor' && existingNews.createdBy !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only delete your own news updates' });
    }
    // Admins and super admins can delete any news (no restriction)

    await news.deleteOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: 'News deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete news error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export default withAuth(async (req: AuthRequest, res: NextApiResponse) => {
  if (req.method === 'PUT') {
    return updateNews(req, res);
  } else if (req.method === 'DELETE') {
    return deleteNews(req, res);
  } else {
    res.setHeader('Allow', ['PUT', 'DELETE']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
});


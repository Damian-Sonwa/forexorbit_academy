/**
 * Forums API Route
 * GET: List forum posts for a course/lesson
 * POST: Create forum post
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

async function getForumPosts(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId, lessonId } = req.query;
    const db = await getDb();
    const forumPosts = db.collection('forumPosts');
    const users = db.collection('users');

    let query: any = {};
    if (courseId) query.courseId = courseId;
    if (lessonId) query.lessonId = lessonId;

    const posts = await forumPosts.find(query).sort({ createdAt: -1 }).toArray();

    // Enrich with user details and replies
    const enrichedPosts = await Promise.all(
      posts.map(async (post) => {
        const author = await users.findOne(
          { _id: new ObjectId(post.userId) },
          { projection: { name: 1, email: 1 } }
        );

        // Get replies
        const replies = await forumPosts.find({ parentPostId: post._id.toString() }).toArray();
        const enrichedReplies = await Promise.all(
          replies.map(async (reply) => {
            const replyAuthor = await users.findOne(
              { _id: new ObjectId(reply.userId) },
              { projection: { name: 1, email: 1 } }
            );
            return {
              ...reply,
              author: replyAuthor ? { name: replyAuthor.name, email: replyAuthor.email } : null,
            };
          })
        );

        return {
          ...post,
          author: author ? { name: author.name, email: author.email } : null,
          replies: enrichedReplies,
          replyCount: enrichedReplies.length,
        };
      })
    );

    res.json(enrichedPosts);
  } catch (error: any) {
    console.error('Get forum posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createForumPost(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId, lessonId, title, content, parentPostId } = req.body;
    const userId = req.user!.userId;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content required' });
    }

    if (!courseId && !lessonId) {
      return res.status(400).json({ error: 'courseId or lessonId required' });
    }

    const db = await getDb();
    const forumPosts = db.collection('forumPosts');

    const result = await forumPosts.insertOne({
      courseId: courseId || null,
      lessonId: lessonId || null,
      parentPostId: parentPostId || null,
      userId,
      title,
      content,
      upvotes: 0,
      downvotes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      ...req.body,
    });
  } catch (error: any) {
    console.error('Create forum post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getForumPosts(req, res);
  } else if (req.method === 'POST') {
    return createForumPost(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


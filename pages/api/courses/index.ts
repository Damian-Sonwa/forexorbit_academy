/**
 * Courses API Route
 * GET: List all courses with filters
 * POST: Create new course (admin/instructor only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
// import { ObjectId } from 'mongodb'; // Reserved for future use

// GET all courses
async function getCourses(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const courses = db.collection('courses');
    const progress = db.collection('progress');

    const { category, difficulty, search } = req.query;

    // Build query
    const query: any = {};
    if (category) query.category = category;
    if (difficulty) query.difficulty = difficulty;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const coursesList = await courses.find(query).toArray();

      // Add progress for authenticated users
      if (req.user) {
        const userId = req.user.userId;
        for (const course of coursesList) {
          const courseId = course._id?.toString() || course.id;
          const userProgress = await progress.findOne({
            userId,
            courseId,
          });
          course.progress = userProgress?.progress || 0;
          course.enrolled = !!userProgress;
        }
      }

    res.json(coursesList);
  } catch (error: any) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// POST create course
async function createCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    const { title, description, category, difficulty, instructorId, thumbnail } = req.body;

    if (!title || !description || !category || !difficulty) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const courses = db.collection('courses');

    const result = await courses.insertOne({
      title,
      description,
      category,
      difficulty,
      instructorId: instructorId || req.user!.userId,
      thumbnail: thumbnail || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      ...req.body,
    });
  } catch (error: any) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET handler - no auth required, but check if user exists
async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthRequest;
  // Try to extract user if token exists, but don't require it
  try {
    const jwtLib = await import('@/lib/jwt');
    const token = jwtLib.extractToken(req.headers.authorization || null);
    if (token) {
      const payload = jwtLib.verifyToken(token);
      authReq.user = payload;
    }
  } catch {
    // No token or invalid token - continue without user
  }
  return getCourses(authReq, res);
}

// POST handler - requires auth
async function postHandler(req: AuthRequest, res: NextApiResponse) {
  return createCourse(req, res);
}

export default async function(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getHandler(req, res);
  } else if (req.method === 'POST') {
    return withAuth(postHandler, ['admin', 'instructor'])(req as AuthRequest, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}


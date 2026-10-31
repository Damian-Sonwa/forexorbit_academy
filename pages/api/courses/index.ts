import { unexpectedBody } from '@/lib/public-error';
/**
 * Courses API Route
 * GET: List all courses with filters
 * POST: Create new course (admin/instructor only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { decideAccountAccess, decideCourseCreate, isStoredId } from '@/lib/account-access';
import { isActiveEnrollment } from '@/lib/enrollment-state';
import { decideSessionBinding, extractToken, verifyToken } from '@/lib/jwt';
import { stripCourseVisualAidsFields } from '@/lib/strip-visual-aids-html';
import { presentCourse } from '@/lib/course-response';
import { buildCourseListQuery } from '@/lib/course-list-filter';
import { courseVisibilityFilter } from '@/lib/course-lifecycle';
import { allowRequest, authoringLimiter } from '@/lib/content-rate-limit';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16mb',
    },
  },
};

// GET all courses
async function getCourses(req: AuthRequest, res: NextApiResponse) {
  try {
    const db = await getDb();
    const courses = db.collection('courses');
    const progress = db.collection('progress');

    const progressByCourse = new Map<string, { progress?: number; active?: boolean; withdrawnAt?: unknown }>();
    if (req.user) {
      const rows = await progress.find(
        { userId: req.user.userId },
        { projection: { courseId: 1, progress: 1, active: 1, withdrawnAt: 1 } }
      ).toArray();
      for (const row of rows) {
        if (row.courseId != null) {
          progressByCourse.set(String(row.courseId), {
            progress: typeof row.progress === 'number' ? row.progress : undefined,
            active: row.active === false ? false : undefined,
            withdrawnAt: row.withdrawnAt,
          });
        }
      }
    }

    // Plain-string filters; the search text is matched literally (see lib/course-list-filter).
    // Visibility (lib/course-lifecycle): the public sees published courses; a student also sees
    // archived courses they are still enrolled in; an instructor also sees their own courses in
    // any state; admins see every course.
    const activeCourseIds = [...progressByCourse.entries()]
      .filter(([id, row]) => isActiveEnrollment(row) && ObjectId.isValid(id))
      .map(([id]) => new ObjectId(id));
    const member = req.user ? { userId: req.user.userId, role: req.user.role } : null;
    const instructorIdValues = member && ObjectId.isValid(member.userId)
      ? [member.userId, new ObjectId(member.userId)]
      : [];
    const query = {
      $and: [buildCourseListQuery(req.query), courseVisibilityFilter(member, { activeCourseIds, instructorIdValues })],
    };

    const coursesList = await courses.find(query).project({
      title: 1,
      description: 1,
      category: 1,
      difficulty: 1,
      thumbnail: 1,
      instructorId: 1,
      status: 1,
    }).toArray();
    const views = [];
    for (const course of coursesList) {
      const description = typeof course.description === 'string'
        ? String(stripCourseVisualAidsFields({ description: course.description }).description || '')
        : '';
      let extras = {};
      if (req.user) {
        const courseId = course._id?.toString() || course.id;
        const userProgress = progressByCourse.get(String(course._id)) || progressByCourse.get(String(courseId));
        const activeEnrollment = isActiveEnrollment(userProgress || null);
        extras = {
          progress: activeEnrollment ? Math.min(100, userProgress?.progress || 0) : 0,
          enrolled: activeEnrollment,
        };
      }
      views.push(presentCourse({ ...course, description }, extras));
    }

    res.json(views);
  } catch (error: any) {
    console.error('Get courses error:');
    res.status(500).json(unexpectedBody('api', error));
  }
}

// POST create course
async function createCourse(req: AuthRequest, res: NextApiResponse) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const db = await getDb();
    if (!(await allowRequest(authoringLimiter, { userId: req.user!.userId, res, getDb }))) return;
    const requestedId = typeof body.instructorId === 'string' ? body.instructorId.trim() : '';
    let assignee = null;
    // Admins and the Super Admin assign an instructor; the stored account decides (Decision 5).
    const staffAdmin = req.user!.role === 'admin' || req.user!.role === 'superadmin';
    if (staffAdmin && isStoredId(requestedId)) {
      const record = await db.collection('users').findOne(
        { _id: new ObjectId(requestedId) },
        { projection: { role: 1, status: 1 } }
      );
      assignee = record
        ? { userId: requestedId, role: record.role, status: record.status }
        : null;
    }
    const decision = decideCourseCreate({
      member: { userId: req.user!.userId, role: req.user!.role },
      body,
      assignee,
    });
    if (!decision.ok) {
      const refusal = decision as { status: number; error: string; code?: string; field?: string };
      return res.status(refusal.status).json({ error: refusal.error, code: refusal.code, field: refusal.field });
    }

    const result = await db.collection('courses').insertOne({
      ...decision.document,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.status(201).json({
      id: result.insertedId.toString(),
      ...decision.document,
    });
  } catch {
    console.error(JSON.stringify({ event: 'courseCreate', result: 'failed' }));
    return res.status(500).json(unexpectedBody('api'));
  }
}

// GET handler - no auth required, but check if user exists
async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthRequest;
  // A valid current session may attach this caller's progress. The catalog stays public.
  try {
    const token = extractToken(req.headers.authorization || null);
    if (token) {
      const payload = verifyToken(token);
      if (payload?.userId && ObjectId.isValid(payload.userId)) {
        const record = await (await getDb()).collection('users').findOne(
          { _id: new ObjectId(payload.userId) },
          { projection: { email: 1, role: 1, status: 1, sessionGeneration: 1 } }
        );
        const account = decideAccountAccess({ userId: payload.userId, record });
        const session = decideSessionBinding({
          userId: payload.userId,
          binding: payload.sv,
          generation: record?.sessionGeneration,
          key: process.env.JWT_SECRET || '',
        });
        if (account.ok && session.ok) {
          authReq.user = {
            userId: account.user.userId,
            email: account.user.email,
            role: account.user.role,
          };
        }
      }
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
    return withAuth(postHandler, ['admin', 'instructor', 'superadmin'])(req as AuthRequest, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}


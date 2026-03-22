/**
 * Course Detail API Route
 * GET: Get course by ID
 * PUT: Update course (admin/instructor only)
 * DELETE: Delete course (admin only)
 */

import type { NextApiResponse } from 'next';

/** Rich HTML descriptions can exceed the default 1MB body limit (413 Payload Too Large). */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16mb',
    },
  },
};
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { stripCourseVisualAidsFields, stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import {
  sortLessonsByOrder,
  getPurchasedLessonIdSet,
  computeMonetizationFlags,
} from '@/lib/lesson-monetization';

async function getCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');

    const course = await courses.findOne({ _id: new ObjectId(id as string) });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Get lessons
    const courseLessons = await lessons
      .find({ courseId: id })
      .sort({ order: 1 })
      .toArray();

    const sortedLessons = sortLessonsByOrder(courseLessons as { _id: ObjectId; order?: number; isDemo?: boolean }[]);

    let userProgress: { progress?: number } | null = null;
    if (req.user) {
      userProgress = (await progress.findOne({
        userId: req.user.userId,
        courseId: id,
      })) as { progress?: number } | null;
    }

    let lessonsOut: Record<string, unknown>[] = sortedLessons.map((l) =>
      stripLessonVisualAidsFields(l as Record<string, unknown>) as Record<string, unknown>
    );

    if (req.user?.role === 'student') {
      const lessonIdStrings = sortedLessons.map((l) => l._id.toString());
      const purchasedIds = await getPurchasedLessonIdSet(db, req.user.userId, lessonIdStrings);
      const adsEnabled = process.env.NEXT_PUBLIC_ADS_ENABLED !== 'false';

      lessonsOut = sortedLessons.map((lesson) => {
        let levelOk = true;
        if ((lesson as { requiredLevel?: string }).requiredLevel) {
          levelOk = !!userProgress;
        }
        const flags = computeMonetizationFlags(
          lesson._id.toString(),
          sortedLessons as { _id: ObjectId; isDemo?: boolean }[],
          purchasedIds,
          req.user!.role,
          adsEnabled
        );
        const canOpen = levelOk && flags.unlocked;
        return stripLessonVisualAidsFields({
          ...lesson,
          accessible: canOpen,
          locked: !canOpen,
          monetization: {
            unlocked: flags.unlocked,
            isFreeTier: flags.isFreeTier,
            isDemo: flags.isDemo,
            requiresPayment: flags.requiresPayment,
            showAds: flags.showAds,
            amountKobo: flags.amountKobo,
            currency: flags.currency,
            paymentsConfigured: flags.paymentsConfigured,
          },
        } as Record<string, unknown>) as Record<string, unknown>;
      });
    }

    const coursePayload = {
      ...stripCourseVisualAidsFields(course as Record<string, unknown>),
      lessons: lessonsOut,
    };

    if (req.user) {
      (coursePayload as Record<string, unknown>).progress = userProgress?.progress || 0;
      (coursePayload as Record<string, unknown>).enrolled = !!userProgress;
    }

    res.json(coursePayload);
  } catch (error: any) {
    console.error('Get course error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function updateCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');

    // Check if course exists
    const course = await courses.findOne({ _id: new ObjectId(id as string) });
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Instructors, admins, and superadmins can edit any course
    const userRole = req.user!.role;
    console.log('Update course - User role:', userRole, 'User:', req.user!.email);
    if (userRole !== 'admin' && userRole !== 'instructor' && userRole !== 'superadmin') {
      console.log('Access denied - Role not authorized:', userRole);
      return res.status(403).json({ message: 'Not authorized', role: userRole });
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };

    await courses.updateOne(
      { _id: new ObjectId(id as string) },
      { $set: updateData }
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update course error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function deleteCourse(req: AuthRequest, res: NextApiResponse) {
  try {
    // Allow both admin and superadmin to delete courses
    if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
      return res.status(403).json({ message: 'Admin or Super Admin only' });
    }

    const { id } = req.query;
    const db = await getDb();
    const courses = db.collection('courses');

    await courses.deleteOne({ _id: new ObjectId(id as string) });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete course error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getCourse(req, res);
  } else if (req.method === 'PUT') {
    return updateCourse(req, res);
  } else if (req.method === 'DELETE') {
    return deleteCourse(req, res);
  } else {
    return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withAuth(handler);


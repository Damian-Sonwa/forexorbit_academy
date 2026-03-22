/**
 * Lessons API Route
 * GET: List lessons for a course
 * POST: Create new lesson (admin/instructor only)
 */

import type { NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16mb',
    },
  },
};
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import type { ObjectId } from 'mongodb';
import {
  sortLessonsByOrder,
  getPurchasedLessonIdSet,
  computeMonetizationFlags,
} from '@/lib/lesson-monetization';

async function getLessons(req: AuthRequest, res: NextApiResponse) {
  try {
    const { courseId } = req.query;
    if (!courseId) {
      return res.status(400).json({ error: 'courseId required' });
    }

    const db = await getDb();
    const lessons = db.collection('lessons');
    const progress = db.collection('progress');

    const lessonsList = await lessons
      .find({ courseId })
      .sort({ order: 1 })
      .toArray();

    const sortedList = sortLessonsByOrder(lessonsList as { _id: ObjectId; order?: number }[]);

    // For students, level access + per-lesson monetization (first free, rest paid)
    if (req.user && req.user.role === 'student') {
      const userProgress = await progress.findOne({
        userId: req.user.userId,
        courseId,
      });

      const lessonIdStrings = sortedList.map((l) => l._id.toString());
      const purchasedIds = await getPurchasedLessonIdSet(db, req.user.userId, lessonIdStrings);
      const adsEnabled = process.env.NEXT_PUBLIC_ADS_ENABLED !== 'false';

      const enrichedLessons = sortedList.map((lesson) => {
        const doc = lesson as { _id: ObjectId; order?: number; requiredLevel?: string };
        let levelOk = true;
        if (doc.requiredLevel) {
          levelOk = !!userProgress;
        }
        const flags = computeMonetizationFlags(
          doc._id.toString(),
          sortedList as { _id: ObjectId }[],
          purchasedIds,
          req.user!.role,
          adsEnabled
        );
        const canOpen = levelOk && flags.unlocked;
        return stripLessonVisualAidsFields({
          ...doc,
          accessible: canOpen,
          locked: !canOpen,
          monetization: {
            unlocked: flags.unlocked,
            isFreeTier: flags.isFreeTier,
            requiresPayment: flags.requiresPayment,
            showAds: flags.showAds,
            amountKobo: flags.amountKobo,
            currency: flags.currency,
            paymentsConfigured: flags.paymentsConfigured,
          },
        } as Record<string, unknown>);
      });

      return res.json(enrichedLessons);
    }

    res.json(sortedList.map((l) => stripLessonVisualAidsFields(l as Record<string, unknown>)));
  } catch (error: any) {
    console.error('Get lessons error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createLesson(req: AuthRequest, res: NextApiResponse) {
  try {
    // Instructors, admins, and superadmins can create lessons
    const userRole = req.user!.role;
    console.log('Create lesson - User role:', userRole, 'User:', req.user!.email);
    if (userRole !== 'admin' && userRole !== 'instructor' && userRole !== 'superadmin') {
      console.log('Access denied - Role not authorized:', userRole);
      return res.status(403).json({ error: 'Not authorized', role: userRole });
    }

    const { courseId, title, description, summary, videoUrl, pdfUrl, order, content, type, requiredLevel, resources } = req.body;

    if (!courseId || !title) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDb();
    const lessons = db.collection('lessons');

    const result = await lessons.insertOne({
      courseId,
      title,
      description,
      summary: summary || null, // Short text overview for the topic
      videoUrl: videoUrl || null,
      pdfUrl: pdfUrl || null, // Support PDF lessons
      type: type || 'video', // 'video', 'pdf', 'interactive'
      order: order || 0,
      content,
      resources: resources || [], // Array of resources: { type: 'pdf'|'link'|'slide', url: string, title: string }
      requiredLevel: requiredLevel || null, // Level-based access control
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      ...req.body,
    });
  } catch (error: any) {
    console.error('Create lesson error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getLessons(req, res);
  } else if (req.method === 'POST') {
    return createLesson(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);


/**
 * GET /api/courses/:courseId/lessons
 * Response: { lessons: [...] } — each lesson includes `locked` and `monetization`.
 * Teaching content is included only for lessons this member may read and has unlocked.
 * `?view=outline` returns navigation fields and a short plain-text blurb only (no lesson bodies).
 */

import type { NextApiResponse } from 'next';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import { getDb } from '@/lib/mongodb';
import { listCourseLessons } from '@/lib/course-lesson-list';
import { stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import { toLessonOutline } from '@/lib/lesson-outline-view';
import { presentStudentDocuments, setPrivateNoStore } from '@/lib/lesson-documents';

async function handler(req: AuthRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  // Lock state and content differ per member; never stored by the browser, a proxy or the CDN.
  setPrivateNoStore(res);

  try {
    const courseId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    const db = await getDb();
    const outline = req.query.view === 'outline';
    const result = await listCourseLessons(db, {
      member: { userId: req.user!.userId, role: req.user!.role },
      courseId,
      outline,
    });
    if (!result.ok) {
      return res.status(result.status).json({ message: result.error });
    }
    const lessons = result.lessons.map(stripLessonVisualAidsFields);
    const views = outline ? lessons.map(toLessonOutline) : lessons;
    // Students open documents through GET /api/lessons/:id/document (the outline has none).
    return res.status(200).json({ lessons: outline || req.user!.role !== 'student' ? views : views.map(presentStudentDocuments) });
  } catch {
    console.error(JSON.stringify({ event: 'courseLessons', result: 'failed' }));
    return res.status(500).json({ message: 'Something went wrong. Please try again later.' });
  }
}

export default withAuth(handler);

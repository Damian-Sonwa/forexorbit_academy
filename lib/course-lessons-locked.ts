/**
 * Course lesson list: `locked` is false for isFirstLesson, isDemo, or when user paid for the course; staff always unlocked.
 */

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { stripLessonVisualAidsFields } from '@/lib/strip-visual-aids-html';
import {
  sortLessonsByOrder,
  hasPaidForCourse,
  isStaffRole,
  getCoursePriceKobo,
  getPaystackCurrency,
  isPaystackConfigured,
} from '@/lib/lesson-monetization';

export async function buildSimpleLessonsWithLocked(
  db: Db,
  courseId: string,
  user: { userId: string; role: string } | undefined
): Promise<Record<string, unknown>[]> {
  const lessonsCol = db.collection('lessons');
  const raw = await lessonsCol.find({ courseId }).sort({ order: 1 }).toArray();
  const sorted = sortLessonsByOrder(
    raw as { _id: ObjectId; order?: number; isDemo?: boolean; isFirstLesson?: boolean }[]
  );

  const coursePaid =
    user && user.role === 'student' ? await hasPaidForCourse(db, user.userId, courseId) : true;

  const amountKobo = getCoursePriceKobo();
  const currency = getPaystackCurrency();
  const paymentsConfigured = isPaystackConfigured();

  return sorted.map((lesson, index) => {
    const doc = lesson as Record<string, unknown> & {
      _id: ObjectId;
      isFirstLesson?: boolean;
      isDemo?: boolean;
    };
    const base = stripLessonVisualAidsFields(doc as Record<string, unknown>) as Record<string, unknown>;

    if (!user || isStaffRole(user.role)) {
      return {
        ...base,
        locked: false,
        isFirstLesson: doc.isFirstLesson === true,
        isDemo: doc.isDemo === true,
        monetization: {
          unlocked: true,
          isFreeTier: false,
          isDemo: false,
          requiresPayment: false,
          showAds: false,
          amountKobo,
          currency,
          paymentsConfigured,
        },
      };
    }

    /** First row (index 0) is always free even when isFirstLesson is missing on the document. */
    const isFirstSlot = doc.isFirstLesson === true || index === 0;
    const isDemo = doc.isDemo === true;
    const locked = !(isFirstSlot || isDemo || coursePaid);

    return {
      ...base,
      locked,
      isFirstLesson: doc.isFirstLesson === true,
      isDemo,
      monetization: {
        unlocked: !locked,
        isFreeTier: isFirstSlot,
        isDemo,
        requiresPayment: locked,
        showAds: Boolean((isFirstSlot || isDemo) && process.env.NEXT_PUBLIC_ADS_ENABLED !== 'false'),
        amountKobo,
        currency,
        paymentsConfigured,
      },
    };
  });
}

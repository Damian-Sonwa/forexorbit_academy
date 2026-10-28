/**
 * Course lesson pricing: `locked` is false for isFirstLesson, isDemo, a full-course entitlement, or a
 * legacy purchase of that one lesson; staff always unlocked. Rows carry public lesson fields only,
 * because this helper does not check enrollment. Use lib/course-lesson-list for lesson content.
 */

import type { Db } from 'mongodb';
import { presentLessonRead } from '@/lib/account-access';
import {
  loadCourseEntitlement,
  priceCourseLessons,
  sortLessonsByOrder,
  withholdLockedContent,
} from '@/lib/course-lesson-list';

export async function buildSimpleLessonsWithLocked(
  db: Db,
  courseId: string,
  user: { userId: string; role: string } | undefined,
  preloaded?: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const raw = preloaded ?? await db.collection('lessons').find({ courseId }).sort({ order: 1 }).toArray();
  const sorted = sortLessonsByOrder(raw as Record<string, unknown>[]);
  const entitlement = await loadCourseEntitlement(db, user, courseId, sorted.map((lesson) => String(lesson._id)));
  const pricing = priceCourseLessons(sorted, entitlement);

  return sorted.map((lesson) => {
    const price = pricing.get(String(lesson._id))!;
    const row: Record<string, unknown> = {
      ...presentLessonRead(lesson, false, courseId),
      accessible: false,
      locked: price.locked,
      isFirstLesson: price.isFirstLesson,
      isDemo: price.isDemo,
      monetization: price.monetization,
    };
    return price.locked ? withholdLockedContent(row) : row;
  });
}

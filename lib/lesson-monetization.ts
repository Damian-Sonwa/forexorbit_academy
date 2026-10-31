/**
 * Course monetization: free-preview lessons (lib/course-lesson-list isFreePreviewSlot) + demo lessons free; the rest
 * require a full-course entitlement (verified purchase or explicit grant in userCourseAccess).
 * Legacy per-lesson purchase rows unlock only the lesson they name.
 */

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { COURSE_CURRENCY, COURSE_PRICE_KOBO } from '@/lib/course-price';
import { hasCourseEntitlement, legacyLessonIdsWithAccess } from '@/lib/course-payment';
import { isFreePreviewSlot } from '@/lib/course-lesson-list';

export type MonetizationFlags = {
  unlocked: boolean;
  /** First lesson in course (free tier) — show ads when true and ads enabled */
  isFreeTier: boolean;
  /** Demo lesson: free + ads (same ad rules as free tier when ads enabled) */
  isDemo: boolean;
  /** Paid lesson not yet purchased */
  requiresPayment: boolean;
  /** Show ad slots (banner / interstitial) for this view */
  showAds: boolean;
  amountKobo: number;
  currency: string;
  paymentsConfigured: boolean;
};

/** Exact copy for API 403 responses (student paywall). */
export const LESSON_LOCKED_MESSAGE = 'Lesson locked. Please pay to unlock.';

export type LessonMonetizationPayload = {
  unlocked: boolean;
  isFreeTier: boolean;
  isDemo: boolean;
  requiresPayment: boolean;
  showAds: boolean;
  amountKobo: number;
  currency: string;
  paymentsConfigured: boolean;
};

export function flagsToMonetizationPayload(flags: MonetizationFlags): LessonMonetizationPayload {
  return {
    unlocked: flags.unlocked,
    isFreeTier: flags.isFreeTier,
    isDemo: flags.isDemo,
    requiresPayment: flags.requiresPayment,
    showAds: flags.showAds,
    amountKobo: flags.amountKobo,
    currency: flags.currency,
    paymentsConfigured: flags.paymentsConfigured,
  };
}

/** JSON body for 403 when a student cannot load paid lesson/quiz content. */
export function buildLessonLockedBody(
  flags: MonetizationFlags,
  lesson: { _id: ObjectId; title?: string; courseId: string }
): {
  access: false;
  locked: true;
  message: string;
  monetization: LessonMonetizationPayload;
  lessonMeta: Record<string, string>;
} {
  return {
    access: false as const,
    locked: true as const,
    message: LESSON_LOCKED_MESSAGE,
    monetization: flagsToMonetizationPayload(flags),
    lessonMeta: {
      _id: lesson._id.toString(),
      courseId: String(lesson.courseId),
      title: typeof lesson.title === 'string' && lesson.title.trim() ? lesson.title : 'Lesson',
    },
  };
}

/** UI + API `locked`: false for staff; otherwise blocked if level gate fails or monetization keeps content locked. */
export function isLessonLockedForStudent(
  flags: MonetizationFlags,
  levelOk: boolean,
  role: string
): boolean {
  if (isStaffRole(role)) return false;
  return !(levelOk && flags.unlocked);
}

export function isStaffRole(role: string): boolean {
  return role === 'superadmin' || role === 'admin' || role === 'instructor';
}

/** When false, Paystack secret missing — all lessons stay unlocked (no paywall). */
export function isPaystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
}

/** Full-course price in kobo. Set in code (lib/course-price.js); environment variables do not override it. */
export function getCoursePriceKobo(): number {
  return COURSE_PRICE_KOBO;
}

export function getPaystackCurrency(): string {
  return COURSE_CURRENCY;
}

export function sortLessonsByOrder<
  T extends { _id: ObjectId; order?: number; isDemo?: boolean; isFirstLesson?: boolean },
>(lessons: T[]): T[] {
  return [...lessons].sort((a, b) => {
    const oa = typeof a.order === 'number' ? a.order : 0;
    const ob = typeof b.order === 'number' ? b.order : 0;
    if (oa !== ob) return oa - ob;
    return a._id.toString().localeCompare(b._id.toString());
  });
}

/** Lessons this user holds through a legacy per-lesson purchase. Never widens to the course. */
export async function getPurchasedLessonIdSet(
  db: Db,
  userId: string,
  lessonIdStrings: string[]
): Promise<Set<string>> {
  return legacyLessonIdsWithAccess(db, userId, lessonIdStrings);
}

export async function hasLessonPurchase(db: Db, userId: string, lessonId: string): Promise<boolean> {
  return (await legacyLessonIdsWithAccess(db, userId, [lessonId])).has(String(lessonId));
}

/** Full-course access: a paid userCourseAccess row or an explicit complimentary/manual grant. */
export async function hasPaidForCourse(db: Db, userId: string, courseId: string): Promise<boolean> {
  return hasCourseEntitlement(db, userId, courseId);
}

/**
 * Compute flags for one lesson. `sortedCourseLessons` must be all lessons for the course sorted by order.
 * `courseUnlocked` = paid access to this lesson (full-course entitlement or a legacy purchase of this lesson).
 */
export function computeMonetizationFlags(
  lessonIdStr: string,
  sortedCourseLessons: { _id: ObjectId; isDemo?: boolean; isFirstLesson?: boolean; isFreePreview?: boolean }[],
  courseUnlocked: boolean,
  userRole: string,
  adsEnabled: boolean,
  explicitPreview = false
): MonetizationFlags {
  const paymentsConfigured = isPaystackConfigured();
  const amountKobo = getCoursePriceKobo();
  const currency = getPaystackCurrency();
  const self = sortedCourseLessons.find((l) => l._id.toString() === lessonIdStr);
  const isDemoLesson = Boolean(self?.isDemo);
  /** Free preview: the same rule as the lesson lists (isFreePreviewSlot in lib/course-lesson-list). */
  const index = sortedCourseLessons.findIndex((l) => l._id.toString() === lessonIdStr);
  const isFreeIntro = Boolean(self) && isFreePreviewSlot(self as Record<string, unknown>, index, explicitPreview);

  if (isStaffRole(userRole)) {
    return {
      unlocked: true,
      isFreeTier: false,
      isDemo: isDemoLesson,
      requiresPayment: false,
      showAds: false,
      amountKobo,
      currency,
      paymentsConfigured,
    };
  }

  /** Missing Paystack secret must NOT unlock paid lessons — only free intro, demo, or course purchase rows. */
  if (!paymentsConfigured) {
    if (isFreeIntro) {
      return {
        unlocked: true,
        isFreeTier: true,
        isDemo: false,
        requiresPayment: false,
        showAds: Boolean(adsEnabled),
        amountKobo,
        currency,
        paymentsConfigured: false,
      };
    }
    if (isDemoLesson) {
      return {
        unlocked: true,
        isFreeTier: false,
        isDemo: true,
        requiresPayment: false,
        showAds: Boolean(adsEnabled),
        amountKobo,
        currency,
        paymentsConfigured: false,
      };
    }
    if (courseUnlocked) {
      return {
        unlocked: true,
        isFreeTier: false,
        isDemo: false,
        requiresPayment: false,
        showAds: false,
        amountKobo,
        currency,
        paymentsConfigured: false,
      };
    }
    return {
      unlocked: false,
      isFreeTier: false,
      isDemo: false,
      requiresPayment: true,
      showAds: false,
      amountKobo,
      currency,
      paymentsConfigured: false,
    };
  }

  if (isFreeIntro) {
    return {
      unlocked: true,
      isFreeTier: true,
      isDemo: false,
      requiresPayment: false,
      showAds: Boolean(adsEnabled),
      amountKobo,
      currency,
      paymentsConfigured: true,
    };
  }

  if (isDemoLesson) {
    return {
      unlocked: true,
      isFreeTier: false,
      isDemo: true,
      requiresPayment: false,
      showAds: Boolean(adsEnabled),
      amountKobo,
      currency,
      paymentsConfigured: true,
    };
  }

  if (courseUnlocked) {
    return {
      unlocked: true,
      isFreeTier: false,
      isDemo: false,
      requiresPayment: false,
      showAds: false,
      amountKobo,
      currency,
      paymentsConfigured: true,
    };
  }

  return {
    unlocked: false,
    isFreeTier: false,
    isDemo: false,
    requiresPayment: true,
    showAds: false,
    amountKobo,
    currency,
    paymentsConfigured: true,
  };
}

/** Remove paid content for locked student view (title/description kept for UX). */
export function stripLessonForLockedStudent(lesson: Record<string, unknown>): Record<string, unknown> {
  return {
    ...lesson,
    description: null,
    videoUrl: null,
    pdfUrl: null,
    content: null,
    summary: null,
    lessonSummary: null,
    resources: [],
    quiz: null,
  };
}

export async function getMonetizationForLessonDoc(
  db: Db,
  user: { userId: string; role: string },
  lesson: { _id: ObjectId; courseId: string }
): Promise<{
  flags: MonetizationFlags;
  sortedLessons: { _id: ObjectId; isDemo?: boolean; isFirstLesson?: boolean }[];
}> {
  const lessonsCol = db.collection('lessons');
  // Pricing needs only these fields, never the lesson bodies.
  const raw = await lessonsCol
    .find({ courseId: lesson.courseId }, { projection: { _id: 1, order: 1, isDemo: 1, isFirstLesson: 1, isFreePreview: 1 } })
    .toArray();
  const sorted = sortLessonsByOrder(
    raw as { _id: ObjectId; order?: number; isDemo?: boolean; isFirstLesson?: boolean; isFreePreview?: boolean }[]
  );
  const course = ObjectId.isValid(String(lesson.courseId))
    ? await db.collection('courses').findOne({ _id: new ObjectId(String(lesson.courseId)) }, { projection: { freePreviewExplicit: 1 } })
    : null;
  const explicitPreview = Boolean(course && course.freePreviewExplicit === true);
  const lessonIdStr = lesson._id.toString();
  const courseUnlocked =
    isStaffRole(user.role) ||
    (await hasPaidForCourse(db, user.userId, String(lesson.courseId))) ||
    (await hasLessonPurchase(db, user.userId, lessonIdStr));

  const adsEnabled = process.env.NEXT_PUBLIC_ADS_ENABLED !== 'false';
  const flags = computeMonetizationFlags(lessonIdStr, sorted, courseUnlocked, user.role, adsEnabled, explicitPreview);

  return { flags, sortedLessons: sorted };
}

export type LessonAccessGateResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      message: string;
      /** Present for paywall denials — send as JSON body */
      lockedBody?: ReturnType<typeof buildLessonLockedBody>;
    };

export async function assertStudentCanAccessLessonContent(
  db: Db,
  user: { userId: string; role: string },
  lessonId: string
): Promise<LessonAccessGateResult> {
  if (isStaffRole(user.role)) return { ok: true };

  let oid: ObjectId;
  try {
    oid = new ObjectId(lessonId);
  } catch {
    return { ok: false, status: 400, message: 'Invalid lesson id' };
  }

  const lessonsCol = db.collection('lessons');
  const lesson = await lessonsCol.findOne({ _id: oid });
  if (!lesson) return { ok: false, status: 404, message: 'Lesson not found' };

  const { flags } = await getMonetizationForLessonDoc(db, user, lesson as { _id: ObjectId; courseId: string });
  if (!flags.unlocked) {
    return {
      ok: false,
      status: 403,
      message: LESSON_LOCKED_MESSAGE,
      lockedBody: buildLessonLockedBody(flags, lesson as { _id: ObjectId; title?: string; courseId: string }),
    };
  }
  return { ok: true };
}

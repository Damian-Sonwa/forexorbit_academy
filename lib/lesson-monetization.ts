/**
 * Course monetization: first lesson (by order or isFirstLesson) + demo lessons free; rest require course payment.
 * Legacy per-lesson userLessonAccess rows still grant access to the whole course.
 */

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

/** Legacy name — kept for reads so existing purchase rows still grant access */
export const LESSON_PURCHASES_COLLECTION = 'lessonPurchases';
/** Canonical per-user lesson unlocks after verified Paystack payment (legacy per-lesson; rows include courseId) */
export const USER_ACCESS_COLLECTION = 'userLessonAccess';
/** Per-user course unlock after Paystack course checkout */
export const USER_COURSE_ACCESS_COLLECTION = 'userCourseAccess';
export const PAYSTACK_PAYMENTS_COLLECTION = 'paystackPayments';
export const PAYSTACK_INTENTS_COLLECTION = 'paystackPaymentIntents';

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

export function getLessonPriceKobo(): number {
  const n = parseInt(process.env.PAYSTACK_LESSON_PRICE_KOBO || '300000', 10);
  return Number.isFinite(n) && n > 0 ? n : 300000;
}

/** One-time course unlock (defaults to lesson price if PAYSTACK_COURSE_PRICE_KOBO unset). */
export function getCoursePriceKobo(): number {
  const raw = process.env.PAYSTACK_COURSE_PRICE_KOBO?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return getLessonPriceKobo();
}

export function getPaystackCurrency(): string {
  return (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase();
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

export async function getPurchasedLessonIdSet(
  db: Db,
  userId: string,
  lessonIdStrings: string[]
): Promise<Set<string>> {
  if (lessonIdStrings.length === 0) return new Set();
  const q = { userId, lessonId: { $in: lessonIdStrings } };
  const accessQ = {
    userId,
    lessonId: { $in: lessonIdStrings },
    $or: [{ paid: true }, { paid: { $exists: false } }],
  };
  const [legacy, access] = await Promise.all([
    db.collection(LESSON_PURCHASES_COLLECTION).find(q).project({ lessonId: 1 }).toArray(),
    db.collection(USER_ACCESS_COLLECTION).find(accessQ).project({ lessonId: 1 }).toArray(),
  ]);
  const ids = new Set<string>();
  for (const r of [...legacy, ...access]) {
    ids.add(String(r.lessonId));
  }
  return ids;
}

export async function hasLessonPurchase(db: Db, userId: string, lessonId: string): Promise<boolean> {
  const q = { userId, lessonId };
  const accessQ = {
    userId,
    lessonId,
    $or: [{ paid: true }, { paid: { $exists: false } }],
  };
  const [a, b] = await Promise.all([
    db.collection(LESSON_PURCHASES_COLLECTION).countDocuments(q, { limit: 1 }),
    db.collection(USER_ACCESS_COLLECTION).countDocuments(accessQ, { limit: 1 }),
  ]);
  return a > 0 || b > 0;
}

/** True if the user has paid for full course access (course doc or any lesson unlock row for this course). */
export async function hasPaidForCourse(db: Db, userId: string, courseId: string): Promise<boolean> {
  const courseQ = {
    userId,
    courseId,
    $or: [{ paid: true }, { paid: { $exists: false } }],
  };
  const [courseRow, lessonRow] = await Promise.all([
    db.collection(USER_COURSE_ACCESS_COLLECTION).countDocuments(courseQ, { limit: 1 }),
    db.collection(USER_ACCESS_COLLECTION).countDocuments(courseQ, { limit: 1 }),
  ]);
  if (courseRow > 0 || lessonRow > 0) return true;
  const lessonsCol = db.collection('lessons');
  const inCourse = await lessonsCol.find({ courseId }).project({ _id: 1 }).toArray();
  const ids = inCourse.map((l) => l._id.toString());
  if (ids.length === 0) return false;
  const legacy = await db
    .collection(LESSON_PURCHASES_COLLECTION)
    .find({ userId, lessonId: { $in: ids } })
    .limit(1)
    .toArray();
  return legacy.length > 0;
}

/**
 * Compute flags for one lesson. `sortedCourseLessons` must be all lessons for the course sorted by order.
 * `courseUnlocked` = user paid for the course (or legacy per-lesson row / purchase in this course).
 */
export function computeMonetizationFlags(
  lessonIdStr: string,
  sortedCourseLessons: { _id: ObjectId; isDemo?: boolean; isFirstLesson?: boolean }[],
  courseUnlocked: boolean,
  userRole: string,
  adsEnabled: boolean
): MonetizationFlags {
  const paymentsConfigured = isPaystackConfigured();
  const amountKobo = getCoursePriceKobo();
  const currency = getPaystackCurrency();
  const self = sortedCourseLessons.find((l) => l._id.toString() === lessonIdStr);
  const isDemoLesson = Boolean(self?.isDemo);
  /** Explicit isFirstLesson on doc, or first lesson by order */
  const isFirstLessonMarked = Boolean(self?.isFirstLesson);
  const first = sortedCourseLessons[0]?._id.toString();
  const isFreeIntro = isFirstLessonMarked || Boolean(first && lessonIdStr === first);

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
  const raw = await lessonsCol.find({ courseId: lesson.courseId }).toArray();
  const sorted = sortLessonsByOrder(
    raw as { _id: ObjectId; order?: number; isDemo?: boolean; isFirstLesson?: boolean }[]
  );
  const lessonIdStr = lesson._id.toString();
  const courseUnlocked =
    isStaffRole(user.role) || (await hasPaidForCourse(db, user.userId, String(lesson.courseId)));

  const adsEnabled = process.env.NEXT_PUBLIC_ADS_ENABLED !== 'false';
  const flags = computeMonetizationFlags(lessonIdStr, sorted, courseUnlocked, user.role, adsEnabled);

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

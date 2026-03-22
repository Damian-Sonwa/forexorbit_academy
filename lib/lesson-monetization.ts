/**
 * Per-lesson monetization: first lesson free (+ ads), rest paid via Paystack after purchase record.
 */

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

/** Legacy name — kept for reads so existing purchase rows still grant access */
export const LESSON_PURCHASES_COLLECTION = 'lessonPurchases';
/** Canonical per-user lesson unlocks after verified Paystack payment */
export const USER_ACCESS_COLLECTION = 'userLessonAccess';
export const PAYSTACK_PAYMENTS_COLLECTION = 'paystackPayments';
export const PAYSTACK_INTENTS_COLLECTION = 'paystackPaymentIntents';

export type MonetizationFlags = {
  unlocked: boolean;
  /** First lesson in course (free tier) — show ads when true and ads enabled */
  isFreeTier: boolean;
  /** Paid lesson not yet purchased */
  requiresPayment: boolean;
  /** Show ad slots (banner / interstitial) for this view */
  showAds: boolean;
  amountKobo: number;
  currency: string;
  paymentsConfigured: boolean;
};

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

export function getPaystackCurrency(): string {
  return (process.env.PAYSTACK_CURRENCY || 'NGN').toUpperCase();
}

export function sortLessonsByOrder<T extends { _id: ObjectId; order?: number }>(lessons: T[]): T[] {
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
  const [legacy, access] = await Promise.all([
    db.collection(LESSON_PURCHASES_COLLECTION).find(q).project({ lessonId: 1 }).toArray(),
    db.collection(USER_ACCESS_COLLECTION).find(q).project({ lessonId: 1 }).toArray(),
  ]);
  const ids = new Set<string>();
  for (const r of [...legacy, ...access]) {
    ids.add(String(r.lessonId));
  }
  return ids;
}

export async function hasLessonPurchase(db: Db, userId: string, lessonId: string): Promise<boolean> {
  const q = { userId, lessonId };
  const [a, b] = await Promise.all([
    db.collection(LESSON_PURCHASES_COLLECTION).countDocuments(q, { limit: 1 }),
    db.collection(USER_ACCESS_COLLECTION).countDocuments(q, { limit: 1 }),
  ]);
  return a > 0 || b > 0;
}

/**
 * Compute flags for one lesson. `sortedCourseLessons` must be all lessons for the course sorted by order.
 */
export function computeMonetizationFlags(
  lessonIdStr: string,
  sortedCourseLessons: { _id: ObjectId }[],
  purchasedIds: Set<string>,
  userRole: string,
  adsEnabled: boolean
): MonetizationFlags {
  const paymentsConfigured = isPaystackConfigured();
  const amountKobo = getLessonPriceKobo();
  const currency = getPaystackCurrency();

  if (isStaffRole(userRole)) {
    return {
      unlocked: true,
      isFreeTier: false,
      requiresPayment: false,
      showAds: false,
      amountKobo,
      currency,
      paymentsConfigured,
    };
  }

  if (!paymentsConfigured) {
    const first = sortedCourseLessons[0]?._id.toString();
    const isFreeTier = Boolean(first && lessonIdStr === first);
    return {
      unlocked: true,
      isFreeTier,
      requiresPayment: false,
      showAds: Boolean(isFreeTier && adsEnabled),
      amountKobo,
      currency,
      paymentsConfigured: false,
    };
  }

  const first = sortedCourseLessons[0]?._id.toString();
  const isFreeTier = Boolean(first && lessonIdStr === first);

  if (isFreeTier) {
    return {
      unlocked: true,
      isFreeTier: true,
      requiresPayment: false,
      showAds: Boolean(adsEnabled),
      amountKobo,
      currency,
      paymentsConfigured: true,
    };
  }

  if (purchasedIds.has(lessonIdStr)) {
    return {
      unlocked: true,
      isFreeTier: false,
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
): Promise<{ flags: MonetizationFlags; sortedLessons: { _id: ObjectId }[]; purchasedIds: Set<string> }> {
  const lessonsCol = db.collection('lessons');
  const raw = await lessonsCol.find({ courseId: lesson.courseId }).toArray();
  const sorted = sortLessonsByOrder(raw as { _id: ObjectId; order?: number }[]);
  const lessonIdStr = lesson._id.toString();
  const ids = sorted.map((l) => l._id.toString());
  const purchasedIds = isStaffRole(user.role)
    ? new Set<string>()
    : await getPurchasedLessonIdSet(db, user.userId, ids);

  const adsEnabled = process.env.NEXT_PUBLIC_ADS_ENABLED !== 'false';
  const flags = computeMonetizationFlags(lessonIdStr, sorted, purchasedIds, user.role, adsEnabled);

  return { flags, sortedLessons: sorted, purchasedIds };
}

export async function assertStudentCanAccessLessonContent(
  db: Db,
  user: { userId: string; role: string },
  lessonId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (isStaffRole(user.role)) return { ok: true };

  let oid: ObjectId;
  try {
    oid = new ObjectId(lessonId);
  } catch {
    return { ok: false, status: 400, message: 'Invalid lesson' };
  }

  const lessonsCol = db.collection('lessons');
  const lesson = await lessonsCol.findOne({ _id: oid });
  if (!lesson) return { ok: false, status: 404, message: 'Lesson not found' };

  const { flags } = await getMonetizationForLessonDoc(db, user, lesson as { _id: ObjectId; courseId: string });
  if (!flags.unlocked) {
    return {
      ok: false,
      status: 403,
      message: 'This lesson is locked. Complete payment on the lesson page to unlock content and the quiz.',
    };
  }
  return { ok: true };
}

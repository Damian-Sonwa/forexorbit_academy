import type { Db } from 'mongodb';

type Member = { userId?: string; role?: string; email?: string } | null | undefined;
type LessonDoc = { [key: string]: any };

export type CourseLessonEntitlement = {
  staff: boolean;
  coursePaid: boolean;
  legacyLessonIds: Set<string>;
};

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

export type LessonPricing = {
  locked: boolean;
  isFirstLesson: boolean;
  isDemo: boolean;
  monetization: LessonMonetizationPayload;
};

export const WITHHELD_LESSON_FIELDS: readonly string[];
export const LESSON_LOCKED_MESSAGE: string;

export function readLessonDetail(
  db: Db,
  input: { userId: string; lessonId: unknown; env?: { [key: string]: string | undefined } }
): Promise<{ status: number; body: LessonDoc }>;

export function isStaffRole(role: unknown): boolean;

export function sortLessonsByOrder<T extends LessonDoc>(lessons: T[]): T[];

export function withholdLockedContent<T extends LessonDoc>(view: T): T;

export function loadCourseEntitlement(
  db: Db,
  member: Member,
  courseId: string,
  lessonIds: string[]
): Promise<CourseLessonEntitlement>;

export function priceCourseLessons(
  lessons: LessonDoc[],
  entitlement: CourseLessonEntitlement,
  env?: { [key: string]: string | undefined }
): Map<string, LessonPricing>;

export function presentCourseLessons(input: {
  member: Member;
  course: { _id: unknown; instructorId?: unknown; difficulty?: string | null };
  enrollmentRow: LessonDoc | null;
  lessons: LessonDoc[];
  pricing: Map<string, LessonPricing>;
}): LessonDoc[];

export function listCourseLessons(
  db: Db,
  input: { member: Member; courseId: unknown; env?: { [key: string]: string | undefined } }
): Promise<{ ok: true; status: 200; lessons: LessonDoc[] } | { ok: false; status: 400 | 403 | 404; error: string }>;

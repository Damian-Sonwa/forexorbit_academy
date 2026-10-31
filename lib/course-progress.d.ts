import type { Db } from 'mongodb';

export type CompletionBasis = 'recorded' | 'current' | 'historical' | 'unverified' | null;

export function currentCompletedIds(completedLessons: unknown, currentLessonIds: unknown[]): string[];
export function progressPercent(completedLessons: unknown, currentLessonIds: unknown[]): number;
export function courseCompletion(input: {
  enrollment: { [key: string]: any } | null | undefined;
  currentLessonIds: unknown[];
}): { complete: boolean; basis: CompletionBasis; percent: number };
export function progressFields(input: {
  enrollment: { [key: string]: any } | null | undefined;
  currentLessonIds: unknown[];
  now?: Date;
}): { progress: number; updatedAt: Date; completedAt?: Date; legacyProgress?: unknown };
export function courseIdValues(courseId: unknown): unknown[];
export function currentLessonIdsFor(db: Pick<Db, 'collection'>, courseId: unknown): Promise<string[]>;
export function recordLessonCompletion(
  db: Pick<Db, 'collection'>,
  input: { userId: string; courseId: string; lessonId: string; now?: Date }
): Promise<{ progress: number; completedLessons: unknown[]; completedAt: Date | null } | null>;
export function recomputeCourseProgress(
  db: Pick<Db, 'collection'>,
  courseId: string,
  options?: { now?: Date }
): Promise<{ rows: number; updated: number }>;

import type { Db } from 'mongodb';

type Refusal = { ok: false; status: number; code: string; error: string };

export const MAX_LESSONS_PER_REORDER: number;
export function versionFilter(version: unknown): { [key: string]: unknown };
export function nextLessonPosition(db: Pick<Db, 'collection'>, courseId: string): Promise<number>;
export function touchLessonSet(db: Pick<Db, 'collection'>, courseId: string): Promise<void>;
export function decideLessonReorder(input: {
  member: { userId?: string; role?: string } | null | undefined;
  course: { _id?: unknown; instructorId?: unknown; status?: unknown } | null | undefined;
  lessonIds: unknown;
  currentLessonIds: unknown[];
}): { ok: true; status: 200; courseId: string; lessonIds: string[] } | Refusal;
export function applyLessonReorder(
  db: Pick<Db, 'collection'>,
  input: { courseId: string; lessonIds: string[]; version: unknown }
): Promise<boolean>;

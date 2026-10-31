import type { Db } from 'mongodb';

export const CLAIM_TTL_MS: number;
export const PROTECTED_RECORDS: ReadonlyArray<{ kind: string; collection: string; key: string; byLesson?: boolean }>;
export function protectedRecordKinds(db: Pick<Db, 'collection'>, courseId: string, lessonIds: string[]): Promise<string[]>;
export function decideCourseDeletion(input: {
  member: { userId?: string; role?: string } | null | undefined;
  course: { _id?: unknown; status?: unknown } | null | undefined;
}): { ok: true; status: 200; courseId: string; from: string } | { ok: false; status: number; code: string; error: string };
export function deleteCoursePermanently(
  db: Pick<Db, 'collection'>,
  input: {
    courseId: string;
    from: string;
    actor: { userId: string; email?: string };
    assetsOf?: (course: { [key: string]: any } | null, lessons: Array<{ [key: string]: any }>) => string[];
    now?: Date;
  }
): Promise<
  | { ok: true; status: 200; deleted: { lessons: number; quizzes: number; assignments: number }; assets: string[] }
  | { ok: false; status: number; code: string; error: string; dependents?: string[] }
>;

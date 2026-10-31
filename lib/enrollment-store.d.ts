import type { Db } from 'mongodb';

export const ENROLLMENTS: 'progress';
export function courseIdForms(courseId: string): unknown[];
export function enrollmentQuery(userId: string, courseId: string): Record<string, unknown>;
export function findEnrollment(db: Db, userId: string, courseId: string): Promise<{ [key: string]: any } | null>;
export function ensureActiveEnrollment(
  db: Db,
  input: { userId: string; courseId: string; reactivate?: boolean; via?: string; now?: Date }
): Promise<{ action: 'created' | 'reactivated' | 'existing' | 'withdrawn_kept' }>;

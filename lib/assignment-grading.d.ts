export const MAX_FEEDBACK_LENGTH: number;
export function gradePoints(grade: number, points: number): number;
export function previouslyAwarded(submission: { pointsAwarded?: unknown; status?: unknown; grade?: unknown } | null | undefined, points: number): number;
export function isLate(dueDate: unknown, submittedAt: Date | string): boolean;
export function settlePendingPoints(db: import('mongodb').Db, submission: any): Promise<boolean>;
export function sweepPendingPoints(db: import('mongodb').Db, options?: { apply?: boolean; limit?: number }): Promise<{ pending: number; settled: number; failed: number }>;

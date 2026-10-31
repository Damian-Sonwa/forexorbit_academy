export function isStoredCourseId(value: unknown): boolean;

export function isActiveEnrollment(row: { [key: string]: any } | null): boolean;

export function activeEnrollmentFilter(): {
  active: { $ne: boolean };
  withdrawnAt: { $exists: boolean };
};

export function enrollmentDecisionRecord(row: { [key: string]: any } | null): {
  userId: unknown;
  courseId: unknown;
  progress: number;
  active?: boolean;
  withdrawnAt?: unknown;
} | null;

export function decideEnroll(input: {
  role?: string;
  userId?: string;
  courseId?: string;
  course?: { _id?: unknown; status?: unknown } | null;
  existing?: { [key: string]: any } | null;
}): {
  ok: boolean;
  status: number;
  error?: string;
  code?: string;
  action?: 'insert' | 'reactivate';
  courseId?: string;
  writes?: boolean;
  document?: { [key: string]: any };
};

export function decideUnenroll(input: {
  role?: string;
  userId?: string;
  courseId?: string;
  existing?: { [key: string]: any } | null;
}): {
  ok: boolean;
  status: number;
  error?: string;
  action?: 'none' | 'withdraw';
  courseId?: string;
  writes?: boolean;
};

export function enrollDuplicateStatus(error: { code?: unknown; codeName?: unknown } | null): {
  status: number;
  body: { error: string };
};

export function quizHistoryQuery(userId: unknown, courseId: unknown): {
  userId: string;
  courseId: string;
};

export function presentEnrollmentProgress(
  row: { [key: string]: any } | null,
  details?: {
    course?: { [key: string]: any } | null;
    totalLessons?: number;
    quizScores?: Array<{ [key: string]: any }>;
  } | null
): {
  _id: string;
  userId: string;
  courseId: string;
  progress: number;
  completedLessons: string[];
  completedLessonsCount: number;
  totalLessons: number;
  active: boolean;
  withdrawnAt: unknown;
  course: { [key: string]: any } | null;
  countsTowardActiveTotals: boolean;
  quizScores: Array<{ lessonId: string; score: number; totalQuestions: number; percentage: number }>;
};

export function countsTowardActiveTotals(row: any): boolean;

export function sumActiveCompletedLessons(rows: any[] | null): number;

export function courseCountsAsLevelProgress(row: any, lessonIds: any[] | null): boolean;

export function decideStaffCertificate(input: { role?: string } | null): {
  ok: boolean;
  status: number;
  error?: string;
  issues: boolean;
  reactivatesEnrollment: boolean;
};

export function createEnrollmentRepository(): {
  rows: Array<{ [key: string]: any }>;
  commit(decision: { [key: string]: any }, userId: string): { status: number; body: { [key: string]: any } };
};

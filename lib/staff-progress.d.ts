export function summarizeStaffProgress(input: {
  role?: string;
  userId?: string;
  courses?: any[] | null;
  rows?: any[] | null;
  difficulty?: string;
  courseId?: string;
}): {
  ok: boolean;
  status: number;
  error?: string;
  courses?: Array<{
    courseId: string;
    title: string;
    difficulty: string;
    activeEnrollments: number;
    completed: number;
    inProgress: number;
  }>;
  totals?: { students: number; courses: number; completed: number; inProgress: number };
};

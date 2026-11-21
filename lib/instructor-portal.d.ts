/** Types for lib/instructor-portal.js (Phase 12). Also the frontend's contract for the portal. */
import type { Db } from 'mongodb';

type Member = { userId: string; role: string };
type Refusal = { ok: false; status: number; error: string };
export type Paging = { page: number; limit: number; total: number; pages: number };
export type CourseOption = { courseId: string; title: string };

export type OverviewMetrics = {
  courses: number;
  coursesByStatus: Record<'draft' | 'in_review' | 'published' | 'archived', number>;
  students: number;
  enrollments: number;
  completionRate: number | null;
  averageProgress: number | null;
  activeLearners7d: number;
  pendingSubmissions: number;
  latePending: number;
  gradedSubmissions: number;
  oldestPendingAt: string | null;
  quizAttempts: number;
  quizPassRate: number | null;
  quizAveragePercent: number | null;
};
export type CourseRow = { courseId: string; title: string; status: string; difficulty: string | null; lessons: number; enrollments: number; completionRate: number | null; averageProgress: number | null; pendingSubmissions: number; updatedAt: string | null };
export type TeachingEvent = { type: 'submission' | 'submission_graded' | 'enrollment'; at: string | null; student: string; studentId: string; courseId: string; courseTitle: string; assignmentTitle: string | null; submissionId: string | null; late: boolean };
export type InstructorOverview = { scope: 'assigned' | 'all'; metrics: OverviewMetrics; courses: CourseRow[]; recent: TeachingEvent[] };

export type StudentRow = {
  studentId: string;
  name: string;
  level: string | null;
  courseId: string;
  courseTitle: string;
  status: 'completed' | 'in_progress' | 'not_started';
  progress: number;
  completedLessons: number;
  totalLessons: number;
  enrolledAt: string | null;
  lastActivityAt: string | null;
  activeRecently: boolean;
  quiz: { attempts: number; averagePercent: number | null; passed: number };
  submissions: { submitted: number; pending: number; graded: number };
};
export type StudentList = { rows: StudentRow[]; courses: CourseOption[]; pagination: Paging };

export type StudentDetail = {
  student: { studentId: string; name: string; level: string | null; joinedAt: string | null };
  courses: Array<{ courseId: string; title: string; progress: number; completedAt: string | null; enrolledAt: string | null; lastActivityAt: string | null; lessons: Array<{ lessonId: string; title: string; completed: boolean; completedAt: string | null }> }>;
  quizzes: Array<{ lessonId: string; lessonTitle: string; courseId: string | null; attempt: number | null; status: string; percent: number | null; passed: boolean | null; finishedAt: string | null }>;
  submissions: Array<{ submissionId: string; assignmentId: string; assignmentTitle: string; courseId: string | null; status: 'graded' | 'pending'; grade: number | null; late: boolean; submittedAt: string | null; gradedAt: string | null }>;
  activity: Array<{ type: string; at: string | null; title: string; courseTitle: string | null; percent?: number | null; passed?: boolean | null; late?: boolean }>;
};

export type QueueRow = {
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  points: number;
  dueDate: string | null;
  courseId: string;
  courseTitle: string;
  studentId: string;
  student: string;
  status: 'graded' | 'pending';
  grade: number | null;
  late: boolean;
  submittedAt: string | null;
  gradedAt: string | null;
  preview: string;
  hasFile: boolean;
};
export type SubmissionQueue = {
  filter: 'pending' | 'graded' | 'late' | 'all';
  rows: QueueRow[];
  counts: { pending: number; graded: number; late: number };
  assignments: Array<{ assignmentId: string; title: string; courseId: string }>;
  courses: CourseOption[];
  pagination: Paging;
};
export type SubmissionReview = {
  submission: {
    submissionId: string;
    studentId: string;
    student: string;
    status: 'graded' | 'pending';
    grade: number | null;
    feedback: string | null;
    late: boolean;
    submittedAt: string | null;
    gradedAt: string | null;
    submissionText: string;
    submissionFile: string | null;
    gradeVersion: number;
    gradeHistory: Array<{ grade: number; previousGrade: number | null; feedback: string | null; reason: string | null; gradedBy: string; gradedAt: string | null }>;
    previousVersions: Array<{ submittedAt: string | null; grade: number | null }>;
  };
  assignment: { assignmentId: string; title: string; instructions: string; description: string; points: number; dueDate: string | null; courseId: string; courseTitle: string; lessonId: string | null };
};
export type ActivityRow = {
  id: string;
  action: string;
  label: string;
  at: string | null;
  courseTitle: string | null;
  assignmentTitle: string | null;
  student: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  byYou: boolean;
  direction: 'assigned_to_you' | 'moved_from_you' | null;
};
export type ActivityPage = { rows: ActivityRow[]; pagination: Paging };
export type InstructorProfile = {
  profile: { name: string; email: string; role: string; status: string; joinedAt: string | null; hasPhoto: boolean };
  courses: Array<{ courseId: string; title: string; status: string }>;
};

type R<T> = Promise<({ ok: true } & T) | Refusal>;
export const QUEUE_STATUSES: readonly string[];
export function teachingScope(db: Db, member: Member, options?: { courseId?: string }): R<{ courses: unknown[]; ids: string[] }>;
export function instructorOverview(db: Db, member: Member, options?: { now?: Date }): R<InstructorOverview>;
export function instructorStudents(db: Db, member: Member, options?: { courseId?: string; q?: string; status?: string; page?: number; limit?: number; now?: Date }): R<StudentList>;
export function instructorStudentDetail(db: Db, member: Member, options: { studentId: string; courseId?: string }): R<StudentDetail>;
export function instructorSubmissions(db: Db, member: Member, options?: { status?: string; courseId?: string; assignmentId?: string; page?: number; limit?: number }): R<SubmissionQueue>;
export function submissionDetail(db: Db, member: Member, options: { submissionId: string }): R<SubmissionReview>;
export function instructorActivity(db: Db, member: Member, options?: { page?: number; limit?: number }): R<ActivityPage>;
export function instructorProfile(db: Db, member: Member): R<InstructorProfile>;

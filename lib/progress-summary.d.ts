import type { Db } from 'mongodb';
import type { LearningStats } from './learning-activity';

export type SummaryCourse = {
  courseId: string;
  title: string;
  thumbnail: string | null;
  difficulty: string | null;
  category: string | null;
  archived: boolean;
  status: 'completed' | 'in_progress' | 'not_started';
  percent: number;
  completedLessons: number;
  totalLessons: number;
  completedAt: string | null;
  lastViewedAt: string | null;
  lastStudiedAt: string | null;
  lastLesson: { lessonId: string; title: string } | null;
  next: { lessonId: string | null; title: string | null; reason: string } | null;
};
export type ProgressSummary = {
  continue: { courseId: string; courseTitle: string; lessonId: string | null; lessonTitle: string | null; reason: string; percent: number } | null;
  totals: { enrolled: number; completedCourses: number; inProgressCourses: number; completedLessons: number };
  courses: SummaryCourse[];
  inProgress: SummaryCourse[];
  completed: SummaryCourse[];
  recent: SummaryCourse[];
  learning: LearningStats;
};
export const RECENT_LIMIT: number;
export function buildProgressSummary(
  db: Db,
  input: { userId: string; role?: string; now?: Date; env?: Record<string, string | undefined> }
): Promise<ProgressSummary>;

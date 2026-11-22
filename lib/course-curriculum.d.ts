import type { Db, Document } from 'mongodb';
import type { Block, Module, Readiness } from './course-content';

export const BUILDER_LESSON_LIMIT: number;

export type BuilderLesson = {
  id: string;
  title: string;
  moduleId: string | null;
  order: number;
  blocks: Block[];
  usesBlocks: boolean;
  legacy: { description: string; content: string };
  isFreePreview: boolean;
  revision: number;
  updatedAt: string | Date | null;
  quiz: { questions: number; status?: string } | null;
  assignments: Array<{ id: string; title: string; status: string; dueDate: string | null; points: number }>;
  practicalTasks: Array<{ id: string; title: string; status: string; dueAt: string | null }>;
  kinds: string[];
  minutes: number;
  aiPending: number;
};

export type BuilderAsset = { id: string; name: string; kind: string; mime: string; bytes: number | null; uploadedAt: string | Date | null };

export type BuilderCourse = {
  course: {
    id: string;
    title: string;
    summary: string;
    description: string;
    category: string;
    difficulty: string;
    thumbnail: string;
    objectives: string[];
    prerequisites: string;
    estimatedHours: number | null;
    status: 'draft' | 'in_review' | 'published' | 'archived';
    instructor: { id: string; name: string } | null;
    updatedAt: string | Date | null;
  };
  modules: Array<Module & { lessonIds: string[] }>;
  lessons: BuilderLesson[];
  assets: BuilderAsset[];
  curriculumVersion: number | null;
  readiness: Readiness;
  permissions: { editContent: boolean; transitions: string[]; reassign: boolean; delete: boolean };
  truncated: boolean;
};

export function normalizeCurriculumOrder(db: Db, courseId: string): Promise<boolean>;
export function applyCurriculum(db: Db, input: { courseId: string; version: number | null; modules: Module[]; assignments: Array<{ lessonId: string; moduleId: string; order: number }>; actorId?: string }): Promise<number | null>;
export function quizSummaries(db: Db, lessonIds: string[]): Promise<Map<string, { questions: number; status: string }>>;
export function lessonActivities(db: Db, courseId: string): Promise<Map<string, { assignments: unknown[]; practicalTasks: unknown[] }>>;
export function loadBuilderCourse(db: Db, member: { userId: string; role: string }, course: Document): Promise<BuilderCourse>;

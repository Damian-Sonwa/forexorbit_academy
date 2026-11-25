/**
 * A lesson exactly as students see it, for the builder: the shared header, body renderer and
 * activities (components/course/*), plus the completion button and previous/next navigation in
 * their student positions. Preview mode never records progress, attempts or submissions; the
 * banner says so. Content is whatever the builder passes (unsaved changes included).
 */

import { Eye } from 'lucide-react';
import LessonHeader from '@/components/course/LessonHeader';
import LessonBlocks from '@/components/course/LessonBlocks';
import LessonActivities from '@/components/course/LessonActivities';
import type { Block } from '@/lib/course-content';
import type { BuilderLesson } from '@/lib/course-curriculum';

export type PreviewQuiz = { questions: Array<{ id?: string; question: string; options: string[]; correctAnswer: number; points?: number }>; status?: string } | null;

export function PreviewBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-primary-500/40 bg-primary-500/[0.07] px-4 py-3 text-sm text-ink" role="status" data-testid="preview-banner">
      <Eye className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden />
      <span className="flex-1"><strong>Student preview.</strong> This is what students see. Nothing you do here is recorded: no progress, quiz attempts, submissions or notifications.</span>
      {children}
    </div>
  );
}

export default function LessonPreview({ courseId, lesson, title, blocks, position, total, moduleTitle, quiz, resolveAsset, assetNames, prev, next }: {
  courseId: string;
  lesson: BuilderLesson;
  title: string;
  blocks: Block[];
  position: number;
  total: number;
  moduleTitle?: string | null;
  quiz: PreviewQuiz;
  resolveAsset: (assetId: string) => string | null;
  assetNames: Record<string, { name: string; bytes: number | null }>;
  prev?: { label: string; onClick: () => void } | null;
  next?: { label: string; onClick: () => void } | null;
}) {
  const legacyLesson = { _id: lesson.id, description: lesson.legacy.description, content: lesson.legacy.content };
  return (
    <article className="lesson-column" data-testid="lesson-preview">
      <LessonHeader title={title} position={position} total={total} moduleTitle={moduleTitle} />
      <div className="mb-9">
        <LessonBlocks lesson={legacyLesson} blocks={blocks} mode="preview" resolveAsset={resolveAsset} assetNames={assetNames} />
      </div>
      <div className="mb-8">
        <LessonActivities mode="preview" lessonId={lesson.id} courseId={courseId} quiz={quiz} assignments={lesson.assignments} practicalTasks={lesson.practicalTasks} />
      </div>
      <div className="card mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-disabled>
        <p className="text-sm text-ink-muted">Students mark the lesson complete here when they have finished it.</p>
        <button type="button" className="btn btn-primary" disabled title="Not recorded in preview">Mark lesson complete</button>
      </div>
      <nav aria-label="Lesson navigation" className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5 max-sm:[&>.btn]:flex-1 max-sm:[&>.btn]:px-3 max-sm:[&>div]:hidden">
        {prev ? <button type="button" className="btn btn-secondary min-h-[44px]" onClick={prev.onClick}>← {prev.label}</button> : <div />}
        {next ? <button type="button" className="btn btn-primary min-h-[44px] ml-auto" onClick={next.onClick}>{next.label} →</button> : <div />}
      </nav>
    </article>
  );
}

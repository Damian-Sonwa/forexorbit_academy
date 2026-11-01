/**
 * Lesson navigation from the course outline (GET /api/courses/:id/lessons?view=outline) only:
 * previous/next, position, and where to continue. No lesson body is needed, so moving between
 * lessons fetches just the lesson being opened (Phase 7). Lock state shown here is the server's;
 * the lesson read re-checks access on every open.
 */

export type OutlineLesson = {
  _id?: string;
  id?: string;
  courseId?: string;
  title?: string;
  order?: number;
  locked?: boolean;
  accessible?: boolean;
  completed?: boolean;
  isFreePreview?: boolean;
  isFirstLesson?: boolean;
  isDemo?: boolean;
};

export type NavigationTarget = { id: string; title: string; locked: boolean; position: number };

export type LessonNavigation = {
  /** 1-based position of the current lesson, or 0 when it is not in the outline. */
  position: number;
  total: number;
  prev: NavigationTarget | null;
  next: NavigationTarget | null;
  completedCount: number;
};

export function lessonKey(lesson: OutlineLesson | null | undefined): string {
  if (!lesson) return '';
  return String(lesson._id || lesson.id || '');
}

export function lessonHref(courseId: string, lessonId: string): string {
  return `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
}

function target(lessons: OutlineLesson[], index: number): NavigationTarget | null {
  const lesson = lessons[index];
  if (!lesson || !lessonKey(lesson)) return null;
  return {
    id: lessonKey(lesson),
    title: typeof lesson.title === 'string' ? lesson.title : 'Lesson',
    locked: lesson.locked === true,
    position: index + 1,
  };
}

/** `lessons` must be in course order (the outline route sorts by `order`). */
export function resolveLessonNavigation(lessons: OutlineLesson[], currentId: string): LessonNavigation {
  const list = Array.isArray(lessons) ? lessons : [];
  const index = currentId ? list.findIndex((lesson) => lessonKey(lesson) === currentId) : -1;
  const completedCount = list.filter((lesson) => lesson.completed === true).length;
  if (index < 0) return { position: 0, total: list.length, prev: null, next: null, completedCount };
  return {
    position: index + 1,
    total: list.length,
    prev: index > 0 ? target(list, index - 1) : null,
    next: index < list.length - 1 ? target(list, index + 1) : null,
    completedCount,
  };
}

/**
 * The lesson a student should continue with: the first open lesson not yet completed, otherwise
 * the first open lesson. Null when no lesson is open.
 */
export function continueLesson(lessons: OutlineLesson[]): NavigationTarget | null {
  const list = Array.isArray(lessons) ? lessons : [];
  const open = list.map((lesson, index) => ({ lesson, index })).filter(({ lesson }) => lesson.locked !== true && lessonKey(lesson));
  if (!open.length) return null;
  const pick = open.find(({ lesson }) => lesson.completed !== true) || open[0];
  return target(list, pick.index);
}

/** Outline with one lesson marked completed, after the server confirmed the completion. */
export function markCompleted<T extends OutlineLesson>(lessons: T[], lessonId: string): T[] {
  return lessons.map((lesson) => (lessonKey(lesson) === lessonId ? { ...lesson, completed: true } : lesson));
}

/**
 * Lesson outline for course navigation: what the course page and the lesson sidebar show
 * (title, order, lock state, a short plain-text blurb). Full teaching content is left out, so a
 * course with long or image-heavy lessons does not send every lesson body to list them.
 */
import { getLessonDescriptionHtml } from '@/lib/lesson-html';
import { previewText } from '@/lib/plain-text';

/** Characters of description kept per lesson; the course page shows two lines. */
export const LESSON_OUTLINE_PREVIEW_CHARS = 280;

const OUTLINE_KEYS = [
  '_id',
  'id',
  'courseId',
  'title',
  'type',
  'order',
  'duration',
  'locked',
  'accessible',
  'isFirstLesson',
  'isDemo',
  'monetization',
] as const;

export function toLessonOutline(view: Record<string, unknown>): Record<string, unknown> {
  const outline: Record<string, unknown> = {};
  for (const key of OUTLINE_KEYS) {
    if (view[key] !== undefined) outline[key] = view[key];
  }
  const preview = previewText(
    getLessonDescriptionHtml(view as { description?: string | null; summary?: string | null })
  );
  if (preview) {
    outline.description =
      preview.length > LESSON_OUTLINE_PREVIEW_CHARS
        ? `${preview.slice(0, LESSON_OUTLINE_PREVIEW_CHARS).trimEnd()}…`
        : preview;
  }
  return outline;
}

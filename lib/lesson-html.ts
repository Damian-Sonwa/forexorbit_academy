import { stripHtml } from '@/lib/html-sanitizer';

/**
 * Prefer `description` (HTML from rich text); fall back to legacy `summary` (plain or HTML).
 */
export function getLessonDescriptionHtml(
  lesson: { description?: string | null; summary?: string | null } | null | undefined
): string {
  if (!lesson) return '';
  const d = lesson.description;
  const s = lesson.summary;
  if (typeof d === 'string' && d.trim() !== '') return d;
  if (typeof s === 'string' && s.trim() !== '') return s;
  return '';
}

/** True if HTML has visible text (ignores empty Quill markup like <p><br></p>). */
export function hasVisibleHtml(html: string): boolean {
  if (!html || typeof html !== 'string') return false;
  const plain = stripHtml(html).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 0;
}

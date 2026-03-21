/**
 * Removes only the legacy "Visual aids" section label (heading/paragraph/div).
 * Does not remove images or figures — editor images must stay intact.
 */

const VISUAL_AIDS_LABEL = 'visual\\s*aid[s]?';

export function stripVisualAidsPlaceholderHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let s = html;

  // Standalone heading that is only "Visual aids"
  s = s.replace(new RegExp(`<h([1-6])[^>]*>\\s*${VISUAL_AIDS_LABEL}\\s*</h\\1>`, 'gi'), '');

  // Paragraph / div with only Visual aids (optional bold/italic)
  s = s.replace(
    new RegExp(
      `<p[^>]*>\\s*(?:<(?:strong|b|em|i)[^>]*>)?\\s*${VISUAL_AIDS_LABEL}\\s*(?:</(?:strong|b|em|i)>)?\\s*</p>`,
      'gi'
    ),
    ''
  );
  s = s.replace(
    new RegExp(`<div[^>]*>\\s*${VISUAL_AIDS_LABEL}\\s*</div>`, 'gi'),
    ''
  );

  // Drop trailing empty paragraphs often left after removing the "Visual aids" heading (Quill markup).
  s = s.replace(
    /(?:<p[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\u00a0|\s)*<\/p>\s*)+$/gi,
    ''
  );

  return s.trim();
}

/** Strip legacy visual-aids HTML from lesson-shaped API objects before JSON response. */
export function stripLessonVisualAidsFields(lesson: Record<string, unknown>): Record<string, unknown> {
  const out = { ...lesson };
  for (const key of ['content', 'description', 'summary'] as const) {
    if (typeof out[key] === 'string') {
      out[key] = stripVisualAidsPlaceholderHtml(out[key] as string);
    }
  }
  if (out.lessonSummary && typeof out.lessonSummary === 'object') {
    const ls = { ...(out.lessonSummary as Record<string, unknown>) };
    for (const k of ['overview', 'summary'] as const) {
      if (typeof ls[k] === 'string') {
        ls[k] = stripVisualAidsPlaceholderHtml(ls[k] as string);
      }
    }
    ls.screenshots = [];
    out.lessonSummary = ls;
  }
  return out;
}

/** Strip from course description (rich HTML). */
export function stripCourseVisualAidsFields(course: Record<string, unknown>): Record<string, unknown> {
  const out = { ...course };
  if (typeof out.description === 'string') {
    out.description = stripVisualAidsPlaceholderHtml(out.description);
  }
  return out;
}

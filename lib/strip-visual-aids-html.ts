/**
 * Removes legacy "Visual aids" placeholder blocks from stored HTML (DB / old scripts).
 * Targets headings/paragraphs that are only that label, plus immediate following img/figure blocks.
 * Does not strip arbitrary images elsewhere in the lesson.
 */

const VISUAL_AIDS_LABEL = 'visual\\s*aid[s]?';

export function stripVisualAidsPlaceholderHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let s = html;

  // Heading that is only "Visual aids" + immediate figures or img cluster (legacy section)
  s = s.replace(
    new RegExp(
      `<h([1-6])[^>]*>\\s*${VISUAL_AIDS_LABEL}\\s*</h\\1>\\s*(?:<figure[^>]*>[\\s\\S]*?</figure>|<img\\b[^>]*>(?:\\s*<img\\b[^>]*>)*)`,
      'gi'
    ),
    ''
  );

  // Standalone heading line only
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

  return s;
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

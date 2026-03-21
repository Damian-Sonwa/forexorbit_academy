/**
 * Removes the legacy "Visual aids" section label (heading/paragraph/div).
 * Student view also strips images uploaded via the visual-aids Cloudinary folder (see stripVisualAidMediaFromHtml).
 */

const VISUAL_AIDS_LABEL = 'visual\\s*aid[s]?';

/** Cloudinary folder is `forexorbit/visual-aids` — URLs always include `visual-aids` in the path. */
function tagReferencesVisualAidUpload(tag: string): boolean {
  return /visual[-_/]aids/i.test(tag) || /forexorbit%2Fvisual/i.test(tag);
}

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

/**
 * Removes `<img>` (and similar) whose URL points at the dedicated visual-aids upload folder.
 * Used only for student-facing rendering — instructor React Quill still loads unsanitized lesson HTML from state/API.
 */
export function stripVisualAidMediaFromHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let s = html.replace(/<img\b[^>]*>/gi, (tag) => (tagReferencesVisualAidUpload(tag) ? '' : tag));

  s = s.replace(/<picture[^>]*>[\s\S]*?<\/picture>/gi, (block) =>
    tagReferencesVisualAidUpload(block) ? '' : block
  );

  for (let i = 0; i < 4; i++) {
    const next = s.replace(/<figure[^>]*>\s*<\/figure>/gi, '');
    if (next === s) break;
    s = next;
  }

  s = s.replace(
    /<a\b[^>]*href\s*=\s*["'][^"']*visual[-_/]aids[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
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

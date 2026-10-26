/**
 * Removes the legacy "Visual aids" section label (heading/paragraph/div).
 * Student view also strips images uploaded via the visual-aids Cloudinary folder (see stripVisualAidMediaFromHtml).
 */

const VISUAL_AIDS_LABEL = 'visual\\s*aid[s]?';

/**
 * Removes the full "Visual aids" subsection: any heading whose text includes that phrase,
 * plus everything after it until the next heading (or end of HTML). Handles Quill markup
 * like <h2><strong>Visual aids</strong></h2> followed by images/paragraphs.
 */
export function stripVisualAidsSectionFromHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let s = html;
  const blockUntilNextHeading =
    /<h([1-6])[^>]*>[\s\S]*?visual\s*aid[s]?[\s\S]*?<\/h\1>[\s\S]*?(?=<h[1-6]\b)/gi;

  for (let i = 0; i < 24; i++) {
    const next = s.replace(blockUntilNextHeading, '');
    if (next === s) break;
    s = next;
  }

  s = s.replace(
    /<h([1-6])[^>]*>[\s\S]*?visual\s*aid[s]?[\s\S]*?<\/h\1>[\s\S]*$/gi,
    ''
  );

  return s.trim();
}

/** Legacy DB copy for empty visual-aids UI (stored inside lesson HTML). */
const VISUAL_AIDS_DB_PLACEHOLDER_PHRASES: RegExp[] = [
  /charts,?\s*screenshots,?\s*resources,?\s*and\s*visual\s*materials\s*for\s*this\s*lesson/i,
  /no\s*visual\s*aids\s*available\s*yet/i,
  /the\s*instructor\s*will\s*add\s*charts,?\s*graphs,?\s*and\s*resources\s*soon/i,
];

function blockContainsVisualAidsPlaceholder(block: string): boolean {
  return VISUAL_AIDS_DB_PLACEHOLDER_PHRASES.some((re) => re.test(block));
}

/**
 * Removes paragraphs/list items (and similar) that only contain legacy "empty visual aids"
 * placeholder text often saved from MongoDB / old templates.
 */
export function stripVisualAidsDatabasePlaceholders(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let s = html;
  const tagPatterns = [/<p[^>]*>[\s\S]*?<\/p>/gi, /<li[^>]*>[\s\S]*?<\/li>/gi, /<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi];

  for (const tagRe of tagPatterns) {
    for (let i = 0; i < 24; i++) {
      const next = s.replace(tagRe, (block) =>
        blockContainsVisualAidsPlaceholder(block) ? '' : block
      );
      if (next === s) break;
      s = next;
    }
  }

  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/<div[^>]*>\s*<\/div>/gi, '')
      .replace(/<section[^>]*>\s*<\/section>/gi, '');
    if (next === s) break;
    s = next;
  }

  return s.trim();
}

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
 * Removes wrapper blocks (legacy TinyMCE / custom) whose class/id marks a "visual aids" region.
 * Prevents bordered/card-like HTML from rendering on student dashboard and course views.
 */
export function stripVisualAidLegacyContainers(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let s = html;
  const re =
    /<(div|section)\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*(?:visual[\w-]*aid|visualaid|mce-visual|lesson-visual|visual-aids-placeholder|visualaid-empty|lesson-visual-aid)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;

  for (let i = 0; i < 12; i++) {
    const next = s.replace(re, '');
    if (next === s) break;
    s = next;
  }

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

/**
 * Full visual-aids removal pipeline (everything except XSS sanitization).
 * Used by API responses so production always returns cleaned HTML even if the browser
 * caches an older JS bundle; mirrors what `sanitizeForStudentView` applies before `sanitizeHtml`.
 */
export function stripVisualAidsForStudentHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  return stripVisualAidMediaFromHtml(
    stripVisualAidLegacyContainers(
      stripVisualAidsPlaceholderHtml(
        stripVisualAidsDatabasePlaceholders(stripVisualAidsSectionFromHtml(html))
      )
    )
  );
}

/** Strip legacy visual-aids HTML from lesson-shaped API objects before JSON response. */
export function stripLessonVisualAidsFields(lesson: Record<string, unknown>): Record<string, unknown> {
  const out = { ...lesson };
  for (const key of ['content', 'description', 'summary'] as const) {
    if (typeof out[key] === 'string') {
      out[key] = stripVisualAidsForStudentHtml(out[key] as string);
    }
  }
  if (out.lessonSummary && typeof out.lessonSummary === 'object') {
    const ls = { ...(out.lessonSummary as Record<string, unknown>) };
    for (const k of ['overview', 'summary'] as const) {
      if (typeof ls[k] === 'string') {
        ls[k] = stripVisualAidsForStudentHtml(ls[k] as string);
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
    out.description = stripVisualAidsForStudentHtml(out.description);
  }
  return out;
}

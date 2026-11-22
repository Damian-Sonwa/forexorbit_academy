/**
 * The lesson heading as students see it ("Lesson 3 of 12", module, title). Shared by the student
 * lesson page and the builder's previews. Older titles may contain markup; they pass through the
 * student sanitizer as before.
 */

import { sanitizeForStudentView } from '@/lib/html-sanitizer';

export default function LessonHeader({ title, position, total, moduleTitle }: { title: string; position: number; total: number; moduleTitle?: string | null }) {
  return (
    <div className="mb-6">
      {position > 0 && (
        <p className="page-kicker mb-3" data-testid="lesson-position">
          Lesson {position} of {total}
          {moduleTitle ? <span className="text-ink-subtle"> · {moduleTitle}</span> : null}
        </p>
      )}
      <h1
        className="font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink break-words sm:text-[2.25rem]"
        dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(title || 'Lesson') }}
      />
    </div>
  );
}

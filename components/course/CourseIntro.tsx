/**
 * The course details added in the builder, as students see them on the course page: short
 * description, what they will learn, prerequisites and estimated time. Shared by the course page
 * and the builder's course preview. Renders nothing for a course without these details.
 */

import { CheckCircle2, Clock } from 'lucide-react';

export default function CourseIntro({ summary, objectives, prerequisites, estimatedHours, lessons }: { summary?: string; objectives?: string[]; prerequisites?: string; estimatedHours?: number | null; lessons?: number }) {
  const goals = (objectives || []).filter(Boolean);
  if (!summary && !goals.length && !prerequisites && !estimatedHours) return null;
  return (
    <div className="space-y-5" data-testid="course-intro">
      {summary && <p className="text-lg leading-relaxed text-ink">{summary}</p>}
      {(estimatedHours || lessons) ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
          {estimatedHours ? <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" aria-hidden />About {estimatedHours} hour{estimatedHours === 1 ? '' : 's'}</span> : null}
          {lessons ? <span className="num">{lessons} lesson{lessons === 1 ? '' : 's'}</span> : null}
        </p>
      ) : null}
      {goals.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface-2 p-4 sm:p-5">
          <h2 className="font-display text-base font-semibold text-ink">What you will learn</h2>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {goals.map((g) => <li key={g} className="flex gap-2.5 text-sm text-ink"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden />{g}</li>)}
          </ul>
        </section>
      )}
      {prerequisites && (
        <section>
          <h2 className="font-display text-base font-semibold text-ink">Before you start</h2>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{prerequisites}</p>
        </section>
      )}
    </div>
  );
}

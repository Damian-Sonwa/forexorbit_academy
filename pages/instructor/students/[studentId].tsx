/**
 * Instructor portal: one student (Phase 12). GET /api/instructor/students/:id, which answers 404 for
 * a student outside the member's courses. Name and learning records only; no contact details.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { ProgressBar } from '@/components/instructor/portal/Views';
import { Disclosure, EmptyState, ErrorState, Section } from '@/components/student/dashboard/Panels';
import { formatDate, relativeTime } from '@/components/student/dashboard/format';
import { LessonSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import { previewText } from '@/lib/plain-text';
import type { StudentDetail } from '@/lib/instructor-portal';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default function InstructorStudentPage() {
  const router = useRouter();
  const studentId = one(router.query.studentId);
  const courseId = one(router.query.courseId);
  const url = router.isReady && studentId ? `/instructor/students/${studentId}${courseId ? `?courseId=${courseId}` : ''}` : null;
  const { data, error, loading, reload } = usePortalResource<StudentDetail>(url);

  return (
    <PortalShell
      title={data ? data.student.name : 'Student'}
      lede={data ? [data.student.level ? `${data.student.level} level` : null, data.student.joinedAt ? `joined ${formatDate(data.student.joinedAt)}` : null].filter(Boolean).join(' · ') : undefined}
      actions={<Link href="/instructor/students" className="btn btn-ghost btn-sm">← All students</Link>}
    >
      {loading && !data && <LessonSkeleton />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-8">
            <Section title="Courses" kicker="Progress">
              <div className="space-y-3">
                {data.courses.map((c) => (
                  <div key={c.courseId} className="card !p-4" data-testid={`student-course-${c.courseId}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{previewText(c.title)}</p>
                        <p className="text-xs text-ink-subtle">Enrolled {formatDate(c.enrolledAt)} · last active {c.lastActivityAt ? relativeTime(c.lastActivityAt) : 'never'}{c.completedAt ? ` · completed ${formatDate(c.completedAt)}` : ''}</p>
                      </div>
                      <span className="text-sm text-ink-muted num">{c.lessons.filter((l) => l.completed).length}/{c.lessons.length} lessons</span>
                    </div>
                    <div className="mt-3"><ProgressBar value={c.progress} label={`${previewText(c.title)} progress`} /></div>
                    <div className="mt-3">
                      <Disclosure title="Lessons" hint="completed and remaining">
                        <ol className="space-y-1.5 text-sm">
                          {c.lessons.map((l, i) => (
                            <li key={l.lessonId} className="flex items-center justify-between gap-3">
                              <span className={l.completed ? 'text-ink' : 'text-ink-subtle'}><span className="mr-2 text-ink-subtle num">{i + 1}.</span>{previewText(l.title)}</span>
                              <span className="shrink-0 text-xs text-ink-subtle">{l.completed ? (l.completedAt ? formatDate(l.completedAt) : 'completed') : 'not yet'}</span>
                            </li>
                          ))}
                        </ol>
                      </Disclosure>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Assignments" kicker="Submitted work">
              {data.submissions.length === 0 ? <EmptyState title="No submissions yet" /> : (
                <ul className="divide-y divide-[var(--fo-line)] overflow-hidden rounded-panel border border-line bg-surface-1">
                  {data.submissions.map((s) => (
                    <li key={s.submissionId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{previewText(s.assignmentTitle)}</p>
                        <p className="text-xs text-ink-subtle">Submitted {formatDate(s.submittedAt, true)}{s.late ? ' · late' : ''}</p>
                      </div>
                      {s.status === 'graded' ? <span className="chip chip-up num">{s.grade}/100</span> : <span className="chip">To grade</span>}
                      <Link href={`/instructor/grading?submission=${s.submissionId}`} className="btn btn-secondary btn-sm">{s.status === 'graded' ? 'Review' : 'Grade'}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Quizzes" kicker="Automated results">
              {data.quizzes.length === 0 ? <EmptyState title="No quiz attempts yet" /> : (
                <div className="overflow-x-auto rounded-panel border border-line bg-surface-1">
                  <table className="table-orbit w-full text-sm">
                    <thead><tr><th>Lesson</th><th className="text-right">Attempt</th><th className="text-right">Score</th><th>Result</th><th>Finished</th></tr></thead>
                    <tbody>
                      {data.quizzes.map((qz, i) => (
                        <tr key={`${qz.lessonId}:${qz.attempt}:${i}`}>
                          <td>{previewText(qz.lessonTitle)}</td>
                          <td className="text-right num">{qz.attempt ?? '-'}</td>
                          <td className="text-right num">{qz.percent === null ? '-' : `${qz.percent}%`}</td>
                          <td>{qz.passed === null ? <span className="text-ink-subtle">No pass mark</span> : <span className={`chip ${qz.passed ? 'chip-up' : 'chip-down'}`}>{qz.passed ? 'Passed' : 'Not passed'}</span>}</td>
                          <td className="whitespace-nowrap text-xs text-ink-subtle">{formatDate(qz.finishedAt, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-2 text-2xs text-ink-subtle">Quiz scores are graded automatically and cannot be changed here.</p>
                </div>
              )}
            </Section>
          </div>

          <aside>
            <Section title="Recent activity">
              <div className="card !p-4">
                {data.activity.length === 0 ? <p className="text-sm text-ink-subtle">No activity yet.</p> : (
                  <ul className="space-y-2.5">
                    {data.activity.map((a, i) => (
                      <li key={i} className="text-sm">
                        <span className="text-ink">{a.type === 'lesson_completed' ? 'Completed' : a.type === 'quiz_finished' ? 'Quiz' : 'Submitted'} {previewText(a.title)}</span>
                        {a.type === 'quiz_finished' && typeof a.percent === 'number' && <span className="text-ink-muted num"> · {a.percent}%</span>}
                        {a.late && <span className="text-down"> · late</span>}
                        <span className="block text-xs text-ink-subtle">{a.courseTitle ? `${previewText(a.courseTitle)} · ` : ''}{relativeTime(a.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          </aside>
        </div>
      )}
    </PortalShell>
  );
}

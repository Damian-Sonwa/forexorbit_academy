/**
 * Instructor portal: profile (Phase 12). GET /api/instructor/profile. Identity edits use the shared
 * /profile page; account status is managed by the Super Admin (suspend / reactivate).
 */

import Link from 'next/link';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { ErrorState, Section } from '@/components/student/dashboard/Panels';
import { formatDate } from '@/components/student/dashboard/format';
import { LessonSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import { previewText } from '@/lib/plain-text';
import type { InstructorProfile } from '@/lib/instructor-portal';

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', in_review: 'In review', published: 'Published', archived: 'Archived' };

export default function InstructorProfilePage() {
  const { data, error, loading, reload } = usePortalResource<InstructorProfile>('/instructor/profile');
  return (
    <PortalShell title="Profile" lede="Your account and the courses assigned to you." actions={<Link href="/profile" className="btn btn-secondary btn-sm">Edit personal details</Link>}>
      {loading && !data && <LessonSkeleton />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section className="card !p-5" aria-labelledby="profile-account" data-testid="profile-card">
            <h2 id="profile-account" className="section-title">Account</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="readout-label">Name</dt><dd className="mt-0.5 font-semibold text-ink">{data.profile.name}</dd></div>
              <div><dt className="readout-label">Email</dt><dd className="mt-0.5 text-ink [overflow-wrap:anywhere]">{data.profile.email}</dd></div>
              <div><dt className="readout-label">Role</dt><dd className="mt-0.5 capitalize text-ink">{data.profile.role}</dd></div>
              <div><dt className="readout-label">Account status</dt><dd className="mt-0.5"><span className={`chip ${data.profile.status === 'approved' ? 'chip-up' : 'chip-down'}`}>{data.profile.status === 'approved' ? 'Active' : data.profile.status}</span></dd></div>
              <div><dt className="readout-label">Member since</dt><dd className="mt-0.5 text-ink">{formatDate(data.profile.joinedAt)}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-ink-subtle">Account status is managed by the Super Admin. A suspended account cannot use the teaching tools.</p>
          </section>
          <Section title="Assigned courses" kicker={`${data.courses.length} course${data.courses.length === 1 ? '' : 's'}`}>
            {data.courses.length === 0 ? <p className="text-sm text-ink-muted">No courses are assigned to you yet. An admin assigns courses.</p> : (
              <ul className="divide-y divide-[var(--fo-line)] overflow-hidden rounded-panel border border-line bg-surface-1">
                {data.courses.map((c) => (
                  <li key={c.courseId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 truncate text-sm font-medium text-ink">{previewText(c.title)}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="chip">{STATUS_LABEL[c.status] || c.status}</span>
                      <Link href={`/instructor/courses/${c.courseId}`} className="btn btn-ghost btn-sm">Manage</Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </PortalShell>
  );
}

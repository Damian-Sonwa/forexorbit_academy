/**
 * Instructor portal: teaching overview (Phase 12). GET /api/instructor/overview, scoped on the
 * server to the member's courses (admins: all courses). Figures are defined in
 * lib/instructor-portal.js.
 */

import Link from 'next/link';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { CourseTable, GradingCallout, RecentTeaching, TeachingMetrics } from '@/components/instructor/portal/Views';
import { ErrorState, Section } from '@/components/student/dashboard/Panels';
import { MetricSkeleton, TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { InstructorOverview } from '@/lib/instructor-portal';

export default function InstructorOverviewPage() {
  const { data, error, loading, reload } = usePortalResource<InstructorOverview>('/instructor/overview');
  return (
    <PortalShell
      title="Teaching overview"
      lede={data?.scope === 'all' ? 'All courses on the platform (admin view).' : 'Your assigned courses, students and grading at a glance.'}
      badges={data ? { Grading: data.metrics.pendingSubmissions } : undefined}
      actions={<Link href="/instructor/dashboard?section=courses" className="btn btn-secondary btn-sm">Manage courses</Link>}
    >
      {loading && !data && (
        <div className="space-y-6" data-testid="overview-loading"><MetricSkeleton count={6} /><TableSkeleton rows={4} /></div>
      )}
      {error && !data && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div className="space-y-8">
          <TeachingMetrics m={data.metrics} />
          <GradingCallout m={data.metrics} />
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Section title="Courses" kicker="Assigned to you">
              <CourseTable courses={data.courses} />
            </Section>
            <Section title="Recent activity" kicker="In your courses">
              <div className="card !p-4"><RecentTeaching events={data.recent} /></div>
            </Section>
          </div>
        </div>
      )}
    </PortalShell>
  );
}

/** Instructor portal: activity history (Phase 12). GET /api/instructor/activity, from the append-only audit log. */

import { useState } from 'react';
import PortalShell from '@/components/instructor/portal/PortalShell';
import { ActivityLog, Pager } from '@/components/instructor/portal/Views';
import { ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { ActivityPage } from '@/lib/instructor-portal';

export default function InstructorActivityPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = usePortalResource<ActivityPage>(`/instructor/activity?page=${page}`);
  return (
    <PortalShell title="Activity" lede="Grades you have given or changed, and changes to which courses are assigned to you. Recorded in the audit log.">
      {loading && !data && <TableSkeleton rows={5} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div aria-busy={loading}>
          <ActivityLog rows={data.rows} />
          <Pager page={data.pagination.page} pages={data.pagination.pages} onPage={setPage} />
        </div>
      )}
    </PortalShell>
  );
}

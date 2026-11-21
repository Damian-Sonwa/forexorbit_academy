/**
 * The student dashboard from GET /api/student/dashboard (Phase 11), fetched once and shared by every
 * section (no section recomputes or refetches the whole thing on its own). Kept current like the
 * Phase 8 summary: refetched when a completion is persisted for this account, on tab focus and on
 * reconnect (hooks/useProgressSync.ts). Refetches keep the current data on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';
import { createRequestSequence } from '@/lib/lesson-request';
import { useProgressSync } from '@/hooks/useProgressSync';
import type { StudentDashboard } from '@/lib/student-analytics';

export type { StudentDashboard } from '@/lib/student-analytics';

export function useStudentDashboard(enabled: boolean) {
  const [data, setData] = useState<StudentDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(createRequestSequence());

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const id = sequence.current.next();
    setRefreshing(true);
    try {
      const next = await apiClient.get<StudentDashboard>('/student/dashboard');
      if (!sequence.current.isCurrent(id)) return;
      setData(next);
      setError(null);
    } catch (err: unknown) {
      if (isUnauthorizedError(err) || !sequence.current.isCurrent(id)) return;
      setError('Your dashboard could not be loaded.');
    }
    setLoading(false);
    setRefreshing(false);
  }, [enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useProgressSync(() => {
    void refetch();
  }, { enabled });

  return { data, loading: enabled && loading && !data, refreshing: refreshing && Boolean(data), error, refetch };
}

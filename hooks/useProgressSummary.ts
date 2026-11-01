/**
 * The student's learning summary from GET /api/progress/summary (Phase 8), kept current across
 * tabs and devices: refetched when a completion is persisted anywhere for this account, when the
 * tab regains focus, and when the connection comes back (hooks/useProgressSync.ts). Refetches
 * keep the current summary on screen; only the first load shows the loading state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';
import { createRequestSequence } from '@/lib/lesson-request';
import { useProgressSync } from '@/hooks/useProgressSync';
import type { ProgressSummary } from '@/lib/progress-summary';

export type { ProgressSummary, SummaryCourse } from '@/lib/progress-summary';

export function useProgressSummary(enabled: boolean) {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(createRequestSequence());

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const id = sequence.current.next();
    try {
      const data = await apiClient.get<ProgressSummary>('/progress/summary');
      if (!sequence.current.isCurrent(id)) return;
      setSummary(data);
      setError(null);
    } catch (err: unknown) {
      if (isUnauthorizedError(err) || !sequence.current.isCurrent(id)) return;
      setError('Your progress could not be loaded.');
    }
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useProgressSync(() => {
    void refetch();
  }, { enabled });

  return { summary, loading: enabled && loading && !summary, error, refetch };
}

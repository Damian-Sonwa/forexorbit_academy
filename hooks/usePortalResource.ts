/**
 * Loads one instructor-portal resource (Phase 12) with loading, error and retry states. A request
 * superseded by a newer one (filters changed) is ignored. 404 reads as "not in your courses",
 * because the portal APIs answer 404 for anything outside the member's scope.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';

export function usePortalResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const next = await apiClient.get<T>(url);
      if (id !== latest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (id !== latest.current || isUnauthorizedError(err)) return;
      const ax = err as { response?: { status?: number; data?: { error?: string } } };
      setError(ax?.response?.status === 404 ? 'Not found, or not part of your courses.' : ax?.response?.data?.error || 'This could not be loaded.');
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  return { data, error, loading, reload: load, setData };
}

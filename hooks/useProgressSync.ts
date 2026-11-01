/**
 * Keeps a page's progress in step with the server across tabs and devices (Phase 8).
 *
 * The server is authoritative. After a completion is persisted it emits `progressUpdated` to every
 * connection of the account (Socket.IO room `user:<id>`). This hook calls `onChange(event)` for
 * those events (optionally only for one course), and `onChange(null)` (meaning "refetch") when the
 * tab regains focus or becomes visible, and when the socket reconnects, so updates missed while
 * offline, asleep or disconnected are picked up. Refetches are throttled to one per
 * REFETCH_THROTTLE_MS; there is no polling.
 */

import { useEffect, useRef } from 'react';
import { useSocket } from '@/hooks/useSocket';

export type ProgressUpdatedEvent = { courseId: string; lessonId?: string; progress?: number; completedAt?: string | null };

export const REFETCH_THROTTLE_MS = 5_000;

export function useProgressSync(onChange: (event: ProgressUpdatedEvent | null) => void, options: { courseId?: string; enabled?: boolean } = {}) {
  const { socket } = useSocket();
  const latest = useRef(onChange);
  latest.current = onChange;
  const lastRefetch = useRef(0);
  const { courseId, enabled = true } = options;

  useEffect(() => {
    if (!enabled || !socket) return;
    const onUpdate = (data: ProgressUpdatedEvent) => {
      if (!data || typeof data.courseId !== 'string') return;
      if (courseId && data.courseId !== courseId) return;
      latest.current(data);
    };
    const onReconnect = () => latest.current(null);
    socket.on('progressUpdated', onUpdate);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('progressUpdated', onUpdate);
      socket.io.off('reconnect', onReconnect);
    };
  }, [socket, courseId, enabled]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const refetch = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRefetch.current < REFETCH_THROTTLE_MS) return;
      lastRefetch.current = now;
      latest.current(null);
    };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    window.addEventListener('online', refetch);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', refetch);
      window.removeEventListener('online', refetch);
    };
  }, [enabled]);
}

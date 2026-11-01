/**
 * Learning-activity signals from an open lesson (Phase 8, lib/learning-activity.js).
 *
 * Sends 'view' once when the lesson opens, then a 'heartbeat' every HEARTBEAT_SECONDS only while
 * the page is visible AND the student interacted with it (pointer, key, scroll, touch) or a video
 * played within the last ACTIVE_WINDOW_SECONDS. An idle or hidden tab sends nothing, so idle time
 * is never counted. Signals are not queued while offline: the server counts only minutes it saw
 * live, so time cannot be backfilled. The server decides the minute and counts each once per
 * student, so several tabs never add time. Returns `markActive` for video playback.
 */

import { useCallback, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';

export const HEARTBEAT_MS = 30_000;
export const ACTIVE_WINDOW_MS = 60_000;

/** Whether a heartbeat should be sent now (pure; used by the hook and its tests). */
export function shouldSendHeartbeat({ visible, lastActiveAt, now }: { visible: boolean; lastActiveAt: number; now: number }): boolean {
  return visible && now - lastActiveAt <= ACTIVE_WINDOW_MS;
}

export function useLearningActivity(lessonId: string, enabled: boolean) {
  const lastActiveAt = useRef(Date.now());
  const inFlight = useRef(false);

  const markActive = useCallback(() => {
    lastActiveAt.current = Date.now();
  }, []);

  const send = useCallback((event: 'view' | 'heartbeat') => {
    if (inFlight.current || !lessonId) return;
    inFlight.current = true;
    apiClient
      .post('/progress/activity', { lessonId, event })
      .catch(() => {
        // Best effort: a failed or rate-limited signal is simply not counted.
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [lessonId]);

  useEffect(() => {
    if (!enabled || !lessonId || typeof window === 'undefined') return;
    lastActiveAt.current = Date.now();
    send('view');
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    for (const name of events) window.addEventListener(name, markActive, { passive: true });
    const timer = window.setInterval(() => {
      const visible = document.visibilityState === 'visible';
      if (shouldSendHeartbeat({ visible, lastActiveAt: lastActiveAt.current, now: Date.now() })) send('heartbeat');
    }, HEARTBEAT_MS);
    return () => {
      for (const name of events) window.removeEventListener(name, markActive);
      window.clearInterval(timer);
    };
  }, [enabled, lessonId, markActive, send]);

  return { markActive };
}

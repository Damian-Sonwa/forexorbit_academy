/**
 * useLesson Hook
 * Manages lesson data and navigation
 *
 * Phase 7: only the newest request may change state (fast next/next or browser back cannot show
 * the wrong lesson), every outcome ends in a state the page can act on (lesson, unlock offer,
 * enroll first, not found, retryable error), a refresh after an edit keeps the lesson on screen,
 * and a failed load is retried when the browser comes back online.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';
import {
  classifyLessonAnswer,
  classifyLessonFailure,
  createRequestSequence,
} from '@/lib/lesson-request';

export interface LessonMonetization {
  unlocked: boolean;
  isFreeTier: boolean;
  /** Demo task lesson — free with ads when enabled */
  isDemo?: boolean;
  requiresPayment: boolean;
  showAds: boolean;
  amountKobo: number;
  currency: string;
  paymentsConfigured: boolean;
}

export type LessonAccessDeniedPayload = {
  access: false;
  /** Paywall / access denial from GET /api/lessons/:id */
  locked?: boolean;
  message: string;
  monetization?: LessonMonetization;
  lessonMeta?: { _id: string; courseId: string; title: string };
};

export interface LessonResource {
  title?: string;
  type?: string;
  /** For students: the app path GET /api/lessons/:id/document?item=r<n> (null when unavailable). */
  url?: string | null;
  available?: boolean;
}

export interface Lesson {
  _id?: string;
  id?: string;
  courseId: string;
  title: string;
  description?: string;
  videoUrl?: string;
  /** For students: the app path GET /api/lessons/:id/document?item=pdf (null when unavailable). */
  pdfUrl?: string | null;
  pdfAvailable?: boolean;
  resources?: LessonResource[];
  content?: string;
  order: number;
  quiz?: any;
  completed?: boolean;
  /** Present on successful GET /api/lessons/:id when content is allowed */
  access?: boolean;
  monetization?: LessonMonetization;
  accessible?: boolean;
  locked?: boolean;
  isFirstLesson?: boolean;
  isFreePreview?: boolean;
  isDemo?: boolean;
}

export type LessonLoadStatus = 'idle' | 'loading' | 'ready' | 'locked' | 'forbidden' | 'not_found' | 'error';

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function useLesson(lessonId: string | string[] | undefined, enabled = true) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [accessDenied, setAccessDenied] = useState<LessonAccessDeniedPayload | null>(null);
  const [status, setStatus] = useState<LessonLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /** The lesson id the current state belongs to. */
  const [stateFor, setStateFor] = useState<string | null>(null);
  const sequence = useRef(createRequestSequence());
  const shownId = useRef<string | null>(null);

  /** `silent`: keep the current lesson on screen while it reloads (after an edit or unlock). */
  const refetchLesson = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!enabled || !lessonId || Array.isArray(lessonId)) return;
    const requestId = sequence.current.next();
    const silent = options.silent === true && shownId.current === lessonId;
    if (!silent) {
      setStatus('loading');
      setError(null);
      if (shownId.current !== lessonId) {
        // A different lesson: never show the previous one while this one loads.
        setLesson(null);
        setAccessDenied(null);
      }
    }
    let outcome;
    try {
      const res = await apiClient.getAllowingError<Lesson>(`/lessons/${encodeURIComponent(lessonId)}`);
      outcome = classifyLessonAnswer<Lesson>(res);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) return;
      outcome = classifyLessonFailure(isOnline());
    }
    if (!sequence.current.isCurrent(requestId)) return;
    // A 401 makes the API client redirect to sign-in; keep the loading state until it does.
    if (outcome.kind === 'redirecting') return;
    if (outcome.kind === 'error' && silent) {
      // A failed background refresh keeps the lesson the student is reading.
      return;
    }
    shownId.current = lessonId;
    setStateFor(lessonId);
    setOffline(outcome.kind === 'error' && outcome.offline);
    switch (outcome.kind) {
      case 'ok':
        setLesson(outcome.lesson);
        setAccessDenied(null);
        setError(null);
        setStatus('ready');
        return;
      case 'locked':
        setLesson(null);
        setAccessDenied(outcome.payload as LessonAccessDeniedPayload);
        setError(null);
        setStatus('locked');
        return;
      case 'forbidden':
        setLesson(null);
        setAccessDenied(null);
        setError(outcome.message);
        setStatus('forbidden');
        return;
      case 'not_found':
        setLesson(null);
        setAccessDenied(null);
        setError(outcome.message);
        setStatus('not_found');
        return;
      default:
        setLesson(null);
        setAccessDenied(null);
        setError(outcome.message);
        setStatus('error');
    }
  }, [lessonId, enabled]);

  useEffect(() => {
    void refetchLesson();
  }, [refetchLesson]);

  // Network recovery: a load that failed is retried as soon as the browser is back online.
  useEffect(() => {
    if (status !== 'error' || typeof window === 'undefined') return;
    const retry = () => void refetchLesson();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [status, refetchLesson]);

  // State from another lesson (the render right after a route change) is never returned.
  const current = typeof lessonId === 'string' && stateFor === lessonId;
  const effectiveStatus: LessonLoadStatus = current ? status : 'loading';
  return {
    lesson: current ? lesson : null,
    loading: effectiveStatus === 'loading',
    error: current ? error : null,
    accessDenied: current ? accessDenied : null,
    status: effectiveStatus,
    offline: current && offline,
    refetch: refetchLesson,
    setLesson,
  };
}

export function useLessons(courseId: string | string[] | undefined, enabled = true) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(createRequestSequence());

  const refetchLessons = useCallback(async () => {
    if (!enabled || !courseId || Array.isArray(courseId)) return;
    const requestId = sequence.current.next();
    setLoading(true);
    try {
      const data = await apiClient.get<{ lessons: Lesson[] }>(`/courses/${courseId}/lessons?view=outline`);
      if (!sequence.current.isCurrent(requestId)) return;
      setLessons(Array.isArray(data.lessons) ? data.lessons : []);
      setError(null);
    } catch (err: unknown) {
      // A 401 redirects to sign-in; keep loading until it does.
      if (isUnauthorizedError(err) || !sequence.current.isCurrent(requestId)) return;
      setError(isOnline() ? 'The lesson list could not be loaded.' : 'You appear to be offline.');
    }
    setLoading(false);
  }, [courseId, enabled]);

  useEffect(() => {
    void refetchLessons();
  }, [refetchLessons]);

  useEffect(() => {
    if (!error || typeof window === 'undefined') return;
    const retry = () => void refetchLessons();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [error, refetchLessons]);

  return { lessons, loading, error, refetch: refetchLessons, setLessons };
}

/**
 * useLesson Hook
 * Manages lesson data and navigation
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

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
  message: string;
  monetization?: LessonMonetization;
  lessonMeta?: { _id: string; courseId: string; title: string };
};

export interface Lesson {
  _id?: string;
  id?: string;
  courseId: string;
  title: string;
  description?: string;
  videoUrl?: string;
  content?: string;
  order: number;
  quiz?: any;
  completed?: boolean;
  monetization?: LessonMonetization;
  accessible?: boolean;
  locked?: boolean;
}

export function useLesson(lessonId: string | string[] | undefined) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [accessDenied, setAccessDenied] = useState<LessonAccessDeniedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchLesson = useCallback(async () => {
    if (!lessonId || Array.isArray(lessonId)) return;
    try {
      setLoading(true);
      const res = await apiClient.getAllowingError<Lesson>(`/lessons/${lessonId}`);
      if (res.ok && res.status === 200) {
        setLesson(res.data);
        setAccessDenied(null);
        setError(null);
        return;
      }
      if (!res.ok && res.status === 403 && res.data && typeof res.data === 'object') {
        const body = res.data as Record<string, unknown>;
        if (body.access === false && typeof body.message === 'string') {
          setLesson(null);
          setAccessDenied({
            access: false,
            message: body.message,
            monetization: body.monetization as LessonMonetization | undefined,
            lessonMeta: body.lessonMeta as LessonAccessDeniedPayload['lessonMeta'],
          });
          setError(null);
          return;
        }
      }
      if (!res.ok && res.status === 404) {
        setLesson(null);
        setAccessDenied(null);
        setError('Lesson not found');
        return;
      }
      setLesson(null);
      setAccessDenied(null);
      const msg =
        !res.ok && res.data && typeof res.data === 'object' && 'message' in res.data
          ? String((res.data as { message?: unknown }).message || 'Request failed')
          : 'Failed to fetch lesson';
      setError(msg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch lesson';
      setLesson(null);
      setAccessDenied(null);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    void refetchLesson();
  }, [refetchLesson]);

  return { lesson, loading, error, accessDenied, refetch: refetchLesson };
}

export function useLessons(courseId: string | string[] | undefined) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchLessons = useCallback(async () => {
    if (!courseId || Array.isArray(courseId)) return;
    try {
      setLoading(true);
      const data = await apiClient.get<Lesson[]>(`/lessons?courseId=${courseId}`);
      setLessons(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch lessons';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void refetchLessons();
  }, [refetchLessons]);

  return { lessons, loading, error, refetch: refetchLessons };
}



/**
 * useLesson Hook
 * Manages lesson data and navigation
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

export interface LessonMonetization {
  unlocked: boolean;
  isFreeTier: boolean;
  requiresPayment: boolean;
  showAds: boolean;
  amountKobo: number;
  currency: string;
  paymentsConfigured: boolean;
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchLesson = useCallback(async () => {
    if (!lessonId || Array.isArray(lessonId)) return;
    try {
      setLoading(true);
      const data = await apiClient.get<Lesson>(`/lessons/${lessonId}`);
      setLesson(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch lesson';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    void refetchLesson();
  }, [refetchLesson]);

  return { lesson, loading, error, refetch: refetchLesson };
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



/**
 * useLesson Hook
 * Manages lesson data and navigation
 */

import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';

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
}

export function useLesson(lessonId: string | string[] | undefined) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);

  const load = async (id: string) => {
    const current = ++requestId.current;
    try {
      setLoading(true);
      const data = await apiClient.get<Lesson>(`/lessons/${id}`);
      if (requestId.current !== current) return;
      setLesson(data);
      setError(null);
    } catch (err: any) {
      if (requestId.current !== current) return;
      setError(err.message || 'Failed to fetch lesson');
    } finally {
      if (requestId.current === current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!lessonId || Array.isArray(lessonId)) {
      if (Array.isArray(lessonId)) {
        setError('Failed to fetch lesson');
        setLoading(false);
      }
      return;
    }
    load(lessonId);
  }, [lessonId]);

  return {
    lesson,
    loading,
    error,
    refetch: () => {
      if (!lessonId || Array.isArray(lessonId)) return;
      return load(lessonId);
    },
  };
}

export function useLessons(courseId: string | string[] | undefined) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId || Array.isArray(courseId)) return;

    const fetchLessons = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get<Lesson[]>(`/lessons?courseId=${courseId}`);
        setLessons(data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch lessons');
      } finally {
        setLoading(false);
      }
    };

    fetchLessons();
  }, [courseId]);

  return { lessons, loading, error };
}



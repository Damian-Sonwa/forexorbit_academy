/**
 * useLesson Hook
 * Manages lesson data and navigation
 */

import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (!lessonId || Array.isArray(lessonId)) return;

    const fetchLesson = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get<Lesson>(`/lessons/${lessonId}`);
        setLesson(data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch lesson');
      } finally {
        setLoading(false);
      }
    };

    fetchLesson();
  }, [lessonId]);

  return { lesson, loading, error };
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



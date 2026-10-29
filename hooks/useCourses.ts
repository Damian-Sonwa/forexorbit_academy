/**
 * useCourses Hook
 * Manages course data and enrollment
 */

import { useState, useEffect, useRef } from 'react';
import { apiClient, isUnauthorizedError } from '@/lib/api-client';

export interface Course {
  _id?: string;
  id?: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  thumbnail?: string;
  instructorId?: string;
  progress?: number;
  enrolled?: boolean;
  lessons?: Array<{
    _id?: string;
    title: string;
    description: string;
    summary?: string;
    videoUrl?: string;
    pdfUrl?: string;
    type: 'video' | 'pdf' | 'interactive';
    order: number;
    content?: string;
    resources?: Array<{
      type: 'pdf' | 'link' | 'slide';
      url: string;
      title: string;
    }>;
  }>;
}

/**
 * `initialCourses` (from a pre-rendered page) are shown straight away; the live list is still
 * fetched in the background so enrollment state and filters stay current.
 */
export function useCourses(
  filters?: { category?: string; difficulty?: string; search?: string },
  options?: { initialCourses?: Course[] }
) {
  const [courses, setCourses] = useState<Course[]>(options?.initialCourses ?? []);
  const [loading, setLoading] = useState(!(options?.initialCourses && options.initialCourses.length > 0));
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchCourses = async () => {
    const current = ++requestId.current;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters?.category) params.append('category', filters.category);
      if (filters?.difficulty) params.append('difficulty', filters.difficulty);
      if (filters?.search) params.append('search', filters.search);

      const data = await apiClient.get<Course[]>(`/courses?${params.toString()}`);
      if (requestId.current !== current) return;
      setCourses(data);
      setError(null);
    } catch (err: any) {
      if (requestId.current !== current) return;
      setError(err.message || 'Failed to fetch courses');
    } finally {
      if (requestId.current === current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.category, filters?.difficulty, filters?.search]);

  const enroll = async (courseId: string) => {
    try {
      await apiClient.post(`/courses/${courseId}/enroll`);
      await fetchCourses();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to enroll');
    }
  };

  const unenroll = async (courseId: string) => {
    try {
      await apiClient.delete(`/courses/${courseId}/enroll`);
      await fetchCourses();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to unenroll');
    }
  };

  return { courses, loading, error, enroll, unenroll, refetch: fetchCourses };
}

/** `enabled` lets pages wait for auth so guests never hit the auth-only course endpoint. */
export function useCourse(courseId: string | string[] | undefined, enabled = true) {
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !courseId || Array.isArray(courseId)) return;

    const fetchCourse = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get<Course>(`/courses/${courseId}`);
        setCourse(data);
        setError(null);
      } catch (err: any) {
        // A 401 triggers the api-client login redirect; keep the loading state instead of flashing an error.
        if (isUnauthorizedError(err)) return;
        setError(err.message || 'Failed to fetch course');
      }
      setLoading(false);
    };

    fetchCourse();
  }, [courseId, enabled]);

  // Expose a refetch function so pages can refresh course data on socket events
  const refetch = async () => {
    if (!enabled || !courseId || Array.isArray(courseId)) return;
    try {
      const data = await apiClient.get<Course>(`/courses/${courseId}`);
      setCourse(data);
      setError(null);
    } catch (err: any) {
      if (isUnauthorizedError(err)) return;
      setError(err.message || 'Failed to fetch course');
    }
    setLoading(false);
  };

  return { course, loading, error, refetch };
}


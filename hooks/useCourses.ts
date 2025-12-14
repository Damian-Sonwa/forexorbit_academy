/**
 * useCourses Hook
 * Manages course data and enrollment
 */

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

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
  lessons?: any[];
}

export function useCourses(filters?: { category?: string; difficulty?: string; search?: string }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters?.category) params.append('category', filters.category);
      if (filters?.difficulty) params.append('difficulty', filters.difficulty);
      if (filters?.search) params.append('search', filters.search);

      const data = await apiClient.get<Course[]>(`/courses?${params.toString()}`);
      setCourses(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch courses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
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

export function useCourse(courseId: string | string[] | undefined) {
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId || Array.isArray(courseId)) return;

    const fetchCourse = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get<Course>(`/courses/${courseId}`);
        setCourse(data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch course');
      } finally {
        setLoading(false);
      }
    };

    fetchCourse();
  }, [courseId]);

  return { course, loading, error };
}


/**
 * useProgress Hook
 * Manages user progress tracking
 */

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

export interface Progress {
  _id?: string;
  userId: string;
  courseId: string;
  progress: number;
  completedLessons: string[];
  course?: {
    id: string;
    title: string;
    thumbnail?: string;
  };
}

export function useProgress() {
  const [progress, setProgress] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Progress[]>('/progress');
      setProgress(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch progress');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProgress();
  }, []);

  const updateProgress = async (courseId: string, lessonId: string) => {
    try {
      await apiClient.post('/progress', { courseId, lessonId });
      await fetchProgress();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update progress');
    }
  };

  return { progress, loading, error, updateProgress, refetch: fetchProgress };
}


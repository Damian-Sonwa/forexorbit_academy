/**
 * Instructor Demo Trading Tasks Management
 * Tab-based interface for creating tasks, viewing submissions, and providing feedback
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import DemoTasksTabs from '@/components/instructor/demo-tasks/DemoTasksTabs';
import CreateDemoTask from '@/components/instructor/demo-tasks/CreateDemoTask';
import DemoTaskSubmissions from '@/components/instructor/demo-tasks/DemoTaskSubmissions';
import ReviewSubmission from '@/components/instructor/demo-tasks/ReviewSubmission';

interface Student {
  _id: string;
  name: string;
  email: string;
}

export default function InstructorDemoTasks() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user?.role !== 'instructor' && user?.role !== 'admin') {
      router.push('/dashboard');
      return;
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (isAuthenticated && (user?.role === 'instructor' || user?.role === 'admin')) {
      loadStudents();
    }
  }, [isAuthenticated, user]);

  const loadStudents = async () => {
    try {
      setLoading(true);
      // Try to fetch students - if endpoint doesn't exist, continue without it
      try {
        const studentsData = await apiClient.get<Student[]>('/admin/users?role=student');
        setStudents(Array.isArray(studentsData) ? studentsData : []);
      } catch (err) {
        // If endpoint doesn't exist, students list will be empty (can still assign to "All Students")
        console.log('Student list endpoint not available, continuing without it');
        setStudents([]);
      }
    } catch (error) {
      console.error('Failed to load students:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTaskCreated = () => {
    // Task created successfully - could show a toast or refresh
    console.log('Task created successfully');
  };

  if (authLoading || loading) {
    return <LoadingSpinner message="Loading demo tasks..." fullScreen />;
  }

  if (!isAuthenticated || (user?.role !== 'instructor' && user?.role !== 'admin')) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:ml-0 pt-14 lg:pt-6 bg-white lg:bg-gray-50 dark:bg-gray-900 overflow-y-auto w-full">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Demo Trading Tasks</h1>
            <p className="text-gray-600 dark:text-gray-400">
              Create tasks, view student submissions, and provide feedback
            </p>
          </div>

          {/* Tabs Interface */}
          <DemoTasksTabs>
            {{
              create: <CreateDemoTask students={students} onTaskCreated={handleTaskCreated} />,
              submissions: <DemoTaskSubmissions />,
              review: <ReviewSubmission />,
            }}
          </DemoTasksTabs>
        </main>
      </div>

      <Footer />
    </div>
  );
}

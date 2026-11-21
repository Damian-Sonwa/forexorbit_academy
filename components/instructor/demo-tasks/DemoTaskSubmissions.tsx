/**
 * Demo Task Submissions Component
 * Shows list of tasks and their student submissions
 */

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import LoadingSpinner from '@/components/LoadingSpinner';

interface DemoTask {
  _id: string;
  title: string;
  description: string;
  instructions: string;
  assignedBy: string;
  assignedByName?: string;
  createdAt: string;
}

interface Submission {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  taskId: string;
  reasoning: string;
  screenshotUrls: string[];
  submittedAt: string;
  grade?: number | string | null;
  feedback?: string | null;
  reviewedAt?: string | null;
}

interface TaskSubmissions {
  task: {
    _id: string;
    title: string;
    description: string;
    instructions: string;
  };
  submissions: Submission[];
}

export default function DemoTaskSubmissions() {
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<TaskSubmissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const tasksData = await apiClient.get<DemoTask[]>('/demo-trading/tasks');
      setTasks(Array.isArray(tasksData) ? tasksData : []);
    } catch (error) {
      console.error('Failed to load tasks:');
    } finally {
      setLoading(false);
    }
  };

  const loadSubmissions = async (taskId: string) => {
    try {
      setLoadingSubmissions(true);
      const data = await apiClient.get<TaskSubmissions>(`/demo-trading/tasks/${taskId}/submissions`);
      setSubmissions(data);
    } catch (error) {
      console.error('Failed to load submissions:');
      setSubmissions(null);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const handleTaskSelect = (taskId: string) => {
    setSelectedTaskId(taskId);
    loadSubmissions(taskId);
  };

  if (loading) {
    return <LoadingSpinner message="Loading tasks..." />;
  }

  return (
    <div className="space-y-6">
      {/* Tasks List */}
      <div className="card rounded-xl p-6">
        <h2 className="text-xl font-bold mb-4 text-ink">Select a Task</h2>
        
        {tasks.length === 0 ? (
          <p className="text-ink-muted">No tasks created yet.</p>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <button
                key={task._id}
                onClick={() => handleTaskSelect(task._id)}
                className={`
                  w-full text-left p-4 rounded-lg border-2 transition-colors
                  ${
                    selectedTaskId === task._id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-700'
                  }
                `}
              >
                <h3 className="font-semibold text-ink">{task.title}</h3>
                <p className="text-sm mt-1 text-ink-muted">{task.description}</p>
                <p className="text-xs dark:text-gray-500 mt-2 text-ink-muted">
                  Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Submissions for Selected Task */}
      {selectedTaskId && (
        <div className="card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-ink">
              {submissions?.task.title || 'Loading...'} - Submissions
            </h2>
            <button
              onClick={() => loadSubmissions(selectedTaskId)}
              className="btn btn-primary px-4 py-2 text-sm"
            >
              Refresh
            </button>
          </div>

          {loadingSubmissions ? (
            <LoadingSpinner message="Loading submissions..." />
          ) : submissions && submissions.submissions.length > 0 ? (
            <div className="space-y-4">
              {submissions.submissions.map((submission) => (
                <div
                  key={submission._id}
                  className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-ink">
                        {submission.studentName}
                      </h3>
                      <p className="text-sm text-ink-muted">
                        {submission.studentEmail}
                      </p>
                    </div>
                  </div>

                  {submission.reasoning && (
                    <div className="card mb-3 p-3 rounded-lg">
                      <p className="text-xs mb-1 text-ink-muted">Reasoning / Analysis</p>
                      <p className="text-sm whitespace-pre-wrap text-ink-muted">{submission.reasoning}</p>
                    </div>
                  )}

                  {submission.screenshotUrls && submission.screenshotUrls.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs mb-2 text-ink-muted">
                        Screenshot{submission.screenshotUrls.length > 1 ? 's' : ''}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {submission.screenshotUrls.map((url, index) => (
                          <a
                            key={index}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block"
                          >
                            <div className="relative w-full max-w-full h-64 rounded-lg border border-gray-300 dark:border-gray-600 hover:shadow-lg transition-shadow cursor-pointer overflow-hidden bg-gray-100 dark:bg-gray-800">
                              <Image
                                src={url}
                                alt={`Screenshot ${index + 1}`}
                                fill
                                className="object-contain"
                                unoptimized
                                onError={(e) => {
                                  console.error('Failed to load screenshot:', url);
                                  const img = e.target as HTMLImageElement;
                                  img.style.display = 'none';
                                }}
                              />
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-ink-muted">
                    Submitted: {format(new Date(submission.submittedAt), 'MMM dd, yyyy HH:mm')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-8 text-ink-muted">
              No submissions yet for this task.
            </p>
          )}
        </div>
      )}
    </div>
  );
}


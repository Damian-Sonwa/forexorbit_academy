/**
 * Demo Task Submissions Component
 * Shows list of tasks and their student submissions
 */

import { useState, useEffect } from 'react';
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
  screenshot: string | null;
  notes: string;
  pair: string;
  direction: string;
  entryPrice: number;
  result: string;
  profitLoss?: number;
  submittedAt: string;
  grade?: number | string | null;
  feedback?: string | null;
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
      console.error('Failed to load tasks:', error);
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
      console.error('Failed to load submissions:', error);
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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Select a Task</h2>
        
        {tasks.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No tasks created yet.</p>
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
                <h3 className="font-semibold text-gray-900 dark:text-white">{task.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{task.description}</p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                  Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Submissions for Selected Task */}
      {selectedTaskId && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {submissions?.task.title || 'Loading...'} - Submissions
            </h2>
            <button
              onClick={() => loadSubmissions(selectedTaskId)}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium"
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
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {submission.studentName}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {submission.studentEmail}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded text-xs font-medium ${
                      submission.result === 'win' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                      submission.result === 'loss' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                      'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-200'
                    }`}>
                      {submission.result?.toUpperCase() || 'OPEN'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Pair</p>
                      <p className="font-medium text-gray-900 dark:text-white">{submission.pair}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Direction</p>
                      <p className="font-medium text-gray-900 dark:text-white">{submission.direction?.toUpperCase()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Entry Price</p>
                      <p className="font-medium text-gray-900 dark:text-white">{submission.entryPrice}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">P/L</p>
                      <p className={`font-medium ${
                        submission.profitLoss && submission.profitLoss > 0 ? 'text-green-600 dark:text-green-400' :
                        submission.profitLoss && submission.profitLoss < 0 ? 'text-red-600 dark:text-red-400' :
                        'text-gray-900 dark:text-white'
                      }`}>
                        {submission.profitLoss !== undefined ? `$${submission.profitLoss.toFixed(2)}` : '-'}
                      </p>
                    </div>
                  </div>

                  {submission.notes && (
                    <div className="mb-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{submission.notes}</p>
                    </div>
                  )}

                  {submission.screenshot && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Screenshot</p>
                      <a
                        href={submission.screenshot}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                      >
                        <img
                          src={submission.screenshot}
                          alt="Trade screenshot"
                          className="max-w-full h-auto max-h-64 rounded-lg border border-gray-300 dark:border-gray-600 hover:shadow-lg transition-shadow cursor-pointer"
                          onError={(e) => {
                            console.error('Failed to load screenshot:', submission.screenshot);
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2';
                            errorDiv.textContent = 'Failed to load screenshot';
                            img.parentElement?.appendChild(errorDiv);
                          }}
                        />
                      </a>
                    </div>
                  )}

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Submitted: {format(new Date(submission.submittedAt), 'MMM dd, yyyy HH:mm')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              No submissions yet for this task.
            </p>
          )}
        </div>
      )}
    </div>
  );
}


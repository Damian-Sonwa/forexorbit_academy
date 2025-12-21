/**
 * Student Dashboard
 * Restructured with three main sections: Live Trading, Tasks, and Trade Journal
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import LoadingSpinner from '@/components/LoadingSpinner';
import TradingInterface from '@/components/TradingInterface';
import MarketSignal from '@/components/MarketSignal';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import Image from 'next/image';

interface DemoTask {
  _id: string;
  title: string;
  description: string;
  instructions: string;
  assignedBy: string;
  assignedByName?: string;
  dueDate?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
}

interface TaskSubmission {
  _id: string;
  taskId: string;
  reasoning: string;
  screenshotUrls: string[];
  grade?: number | string | null;
  feedback?: string | null;
  reviewedAt?: string | null;
  submittedAt: string;
}

interface TradeJournalEntry {
  _id: string;
  pair: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  result: 'win' | 'loss' | 'breakeven' | 'open';
  profitLoss?: number;
  notes: string;
  screenshot?: string;
  createdAt: string;
}

type ActiveSection = 'live' | 'tasks' | 'journal';

export default function StudentDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { connected } = useSocket();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<ActiveSection>('tasks');
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [taskSubmissions, setTaskSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [journalEntries, setJournalEntries] = useState<TradeJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Trade journal form state
  const [journalForm, setJournalForm] = useState({
    pair: '',
    direction: 'buy' as 'buy' | 'sell',
    entryPrice: '',
    stopLoss: '',
    takeProfit: '',
    lotSize: '',
    result: 'open' as 'win' | 'loss' | 'breakeven' | 'open',
    profitLoss: '',
    notes: '',
    screenshot: '',
  });
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user?.role !== 'student') {
      router.push('/dashboard');
      return;
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'student') {
      loadData();
    }
  }, [isAuthenticated, user]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tasksData, journalData] = await Promise.all([
        apiClient.get<DemoTask[]>('/demo-trading/tasks').catch(() => []),
        apiClient.get<TradeJournalEntry[]>('/demo-trading/journal').catch(() => []),
      ]);
      
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      setJournalEntries(Array.isArray(journalData) ? journalData : []);

      // Load submission status for each task
      if (Array.isArray(tasksData) && tasksData.length > 0) {
        try {
          // Fetch all student submissions at once
          const allSubmissions = await apiClient.get<TaskSubmission[]>(
            '/demo-trading/submissions/student'
          ).catch(() => []);
          
          // Create a map of taskId -> submission
          const submissionsMap: Record<string, TaskSubmission> = {};
          if (Array.isArray(allSubmissions)) {
            allSubmissions.forEach((submission) => {
              if (submission.taskId) {
                submissionsMap[submission.taskId] = submission;
              }
            });
          }
          setTaskSubmissions(submissionsMap);
        } catch (error) {
          console.error('Failed to load submissions:', error);
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTaskStatus = (task: DemoTask): 'pending' | 'submitted' | 'reviewed' | 'graded' => {
    const submission = taskSubmissions[task._id];
    if (!submission) return 'pending';
    if (submission.grade !== null && submission.grade !== undefined) return 'graded';
    if (submission.reviewedAt) return 'reviewed';
    return 'submitted';
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setUploadError('Invalid file type. Only JPG, JPEG, and PNG images are allowed.');
      e.target.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size must be less than 10MB');
      e.target.value = '';
      return;
    }

    try {
      setUploadingScreenshot(true);
      setUploadError(null);
      
      const formData = new FormData();
      formData.append('file', file);

      const data = await apiClient.post<{ success: boolean; url: string; imageUrl?: string; filename: string }>(
        '/demo-trading/journal/upload',
        formData
      );

      const imageUrl = data.imageUrl || data.url;
      setJournalForm({ ...journalForm, screenshot: imageUrl });
      setScreenshotPreview(imageUrl);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to upload screenshot';
      setUploadError(errorMessage);
      console.error('Screenshot upload error:', error);
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const handleSubmitJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      
      const entryData = {
        ...journalForm,
        entryPrice: parseFloat(journalForm.entryPrice),
        stopLoss: parseFloat(journalForm.stopLoss),
        takeProfit: parseFloat(journalForm.takeProfit),
        lotSize: parseFloat(journalForm.lotSize),
        profitLoss: journalForm.profitLoss ? parseFloat(journalForm.profitLoss) : undefined,
        screenshot: journalForm.screenshot || undefined,
      };

      await apiClient.post('/demo-trading/journal', entryData);
      
      // Reset form and close modal
      setShowJournalModal(false);
      setJournalForm({
        pair: '',
        direction: 'buy',
        entryPrice: '',
        stopLoss: '',
        takeProfit: '',
        lotSize: '',
        result: 'open',
        profitLoss: '',
        notes: '',
        screenshot: '',
      });
      setScreenshotPreview(null);
      setUploadError(null);
      
      // Reload data
      await loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save trade journal entry';
      alert(errorMessage);
      console.error('Journal submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return <LoadingSpinner message="Loading dashboard..." fullScreen />;
  }

  if (!isAuthenticated || user?.role !== 'student') {
    return null;
  }

  const pendingTasks = tasks.filter(t => getTaskStatus(t) === 'pending');
  const submittedTasks = tasks.filter(t => getTaskStatus(t) === 'submitted' || getTaskStatus(t) === 'reviewed' || getTaskStatus(t) === 'graded');
  const openTrades = journalEntries.filter(t => t.result === 'open');
  const closedTrades = journalEntries.filter(t => t.result !== 'open');

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:ml-0 pt-14 lg:pt-6 bg-white lg:bg-gray-50 overflow-y-auto w-full">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Student Dashboard</h1>
            <p className="text-gray-600">Live Trading | Tasks | Trade Journal</p>
          </div>

          {/* Section Navigation Tabs */}
          <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto" aria-label="Sections">
              <button
                onClick={() => setActiveSection('live')}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                  ${activeSection === 'live'
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                ⚡ Live Trading
              </button>
              <button
                onClick={() => setActiveSection('tasks')}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                  ${activeSection === 'tasks'
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                📋 Tasks
                {pendingTasks.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                    {pendingTasks.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveSection('journal')}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                  ${activeSection === 'journal'
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                📊 Trade Journal
              </button>
            </nav>
          </div>

          {/* Section Content */}
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-4 sm:p-6">
            {/* Live Trading Section */}
            {activeSection === 'live' && (
              <div className="space-y-6">
                <div className="mb-6 bg-red-50 border-l-4 border-red-400 p-4 rounded-lg">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <span className="text-2xl">⚠️</span>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">Critical Security Notice</h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p className="mb-2">
                          <strong>This is a DEMO trading interface using paper trading only.</strong>
                        </p>
                        <p className="mb-2">• All trades are executed in demo/paper trading mode with virtual money</p>
                        <p className="mb-2">• No real money can be deposited, traded, or withdrawn</p>
                        <p className="mb-2">• ForexOrbit Academy does not provide brokerage services</p>
                        <p>• This feature is for educational purposes only. Trading involves substantial risk.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Market Signals */}
                <div className="mb-6">
                  <MarketSignal />
                </div>

                {/* Trading Interface */}
                <TradingInterface />
              </div>
            )}

            {/* Tasks Section */}
            {activeSection === 'tasks' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-900">Demo Trading Tasks</h2>
                </div>

                {/* Pending Tasks */}
                {pendingTasks.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Pending Tasks</h3>
                    <div className="space-y-4">
                      {pendingTasks.map((task) => {
                        const status = getTaskStatus(task);
                        return (
                          <div key={task._id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="font-semibold text-gray-900">{task.title}</h4>
                                  {task.level && (
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      task.level === 'beginner' ? 'bg-green-100 text-green-800' :
                                      task.level === 'intermediate' ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-red-100 text-red-800'
                                    }`}>
                                      {task.level.charAt(0).toUpperCase() + task.level.slice(1)}
                                    </span>
                                  )}
                                  <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
                                    {status.charAt(0).toUpperCase() + status.slice(1)}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                                {task.instructions && (
                                  <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded mb-2">
                                    <p className="text-sm text-gray-700 whitespace-pre-line">{task.instructions}</p>
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 mt-2">
                                  <span>Assigned by: {task.assignedByName || 'Instructor'}</span>
                                  {task.dueDate && (
                                    <span>Due: {format(new Date(task.dueDate), 'MMM dd, yyyy')}</span>
                                  )}
                                  <span>Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}</span>
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Link
                                  href={`/student-dashboard/tasks/${task._id}`}
                                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium text-center"
                                >
                                  View Task
                                </Link>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Submitted/Reviewed Tasks */}
                {submittedTasks.length > 0 && (
                  <div className={pendingTasks.length > 0 ? 'mt-6' : ''}>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Submitted Tasks</h3>
                    <div className="space-y-4">
                      {submittedTasks.map((task) => {
                        const submission = taskSubmissions[task._id];
                        const status = getTaskStatus(task);
                        return (
                          <div key={task._id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="font-semibold text-gray-900">{task.title}</h4>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    status === 'graded' ? 'bg-green-100 text-green-800' :
                                    status === 'reviewed' ? 'bg-blue-100 text-blue-800' :
                                    'bg-yellow-100 text-yellow-800'
                                  }`}>
                                    {status.charAt(0).toUpperCase() + status.slice(1)}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                                {submission && (
                                  <div className="mt-3 space-y-2">
                                    {submission.grade && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-gray-700">Grade:</span>
                                        <span className="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-bold">
                                          {submission.grade}
                                        </span>
                                      </div>
                                    )}
                                    {submission.feedback && (
                                      <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded">
                                        <p className="text-sm font-semibold text-green-800 mb-1">Instructor Feedback:</p>
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{submission.feedback}</p>
                                      </div>
                                    )}
                                    {submission.reviewedAt && (
                                      <p className="text-xs text-gray-500">
                                        Reviewed: {format(new Date(submission.reviewedAt), 'MMM dd, yyyy HH:mm')}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Link
                                  href={`/student-dashboard/tasks/${task._id}`}
                                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium text-center"
                                >
                                  View Details
                                </Link>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {tasks.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-gray-500 mb-4">No tasks assigned yet.</p>
                    <p className="text-sm text-gray-400">Your instructor will assign practice tasks here.</p>
                  </div>
                )}
              </div>
            )}

            {/* Trade Journal Section */}
            {activeSection === 'journal' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-900">Trade Journal</h2>
                  <button
                    onClick={() => setShowJournalModal(true)}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium"
                  >
                    + Add Trade
                  </button>
                </div>

                {/* Open Trades */}
                {openTrades.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Open Trades</h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pair</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SL</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lot Size</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {openTrades.map((trade) => (
                            <tr key={trade._id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">{trade.pair}</td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${
                                  trade.direction === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {trade.direction.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900">{trade.entryPrice}</td>
                              <td className="px-4 py-3 text-sm text-gray-900">{trade.stopLoss}</td>
                              <td className="px-4 py-3 text-sm text-gray-900">{trade.takeProfit}</td>
                              <td className="px-4 py-3 text-sm text-gray-900">{trade.lotSize}</td>
                              <td className="px-4 py-3 text-sm text-gray-500">{format(new Date(trade.createdAt), 'MMM dd, yyyy')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Closed Trades */}
                {closedTrades.length > 0 && (
                  <div className={openTrades.length > 0 ? 'mt-6' : ''}>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Closed Trades</h3>
                    <div className="space-y-4">
                      {closedTrades.map((trade) => (
                        <div key={trade._id} className="border border-gray-200 rounded-lg p-4 bg-white hover:shadow-md transition-shadow">
                          <div className="grid md:grid-cols-6 gap-4 items-center">
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Pair</p>
                              <p className="text-sm font-medium text-gray-900">{trade.pair}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Direction</p>
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                trade.direction === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {trade.direction.toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Entry</p>
                              <p className="text-sm text-gray-900">{trade.entryPrice}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Result</p>
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                trade.result === 'win' ? 'bg-green-100 text-green-800' :
                                trade.result === 'loss' ? 'bg-red-100 text-red-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {trade.result.toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">P/L</p>
                              <p className={`text-sm font-medium ${
                                trade.profitLoss && trade.profitLoss > 0 ? 'text-green-600' :
                                trade.profitLoss && trade.profitLoss < 0 ? 'text-red-600' : 'text-gray-900'
                              }`}>
                                {trade.profitLoss !== undefined ? `$${trade.profitLoss.toFixed(2)}` : '-'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Date</p>
                              <p className="text-sm text-gray-500">{format(new Date(trade.createdAt), 'MMM dd, yyyy')}</p>
                            </div>
                          </div>
                          {(trade.notes || trade.screenshot) && (
                            <div className="mt-4 pt-4 border-t border-gray-200">
                              {trade.notes && (
                                <div className="mb-3">
                                  <p className="text-xs text-gray-500 mb-1">Notes</p>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{trade.notes}</p>
                                </div>
                              )}
                              {trade.screenshot && (
                                <div>
                                  <p className="text-xs text-gray-500 mb-2">Screenshot</p>
                                  <div className="relative w-full max-w-md h-48 rounded-lg overflow-hidden border border-gray-300">
                                    <Image
                                      src={trade.screenshot}
                                      alt="Trade screenshot"
                                      fill
                                      className="object-contain"
                                      onError={(e) => {
                                        console.error('Failed to load trade screenshot:', trade.screenshot);
                                        const img = e.target as HTMLImageElement;
                                        img.style.display = 'none';
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {journalEntries.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-gray-500 mb-4">No trades logged yet.</p>
                    <button
                      onClick={() => setShowJournalModal(true)}
                      className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
                    >
                      Log Your First Trade
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Trade Journal Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Log Trade</h2>
                <button
                  onClick={() => {
                    setShowJournalModal(false);
                    setJournalForm({
                      pair: '',
                      direction: 'buy',
                      entryPrice: '',
                      stopLoss: '',
                      takeProfit: '',
                      lotSize: '',
                      result: 'open',
                      profitLoss: '',
                      notes: '',
                      screenshot: '',
                    });
                    setScreenshotPreview(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmitJournal} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Currency Pair *</label>
                    <input
                      type="text"
                      required
                      value={journalForm.pair}
                      onChange={(e) => setJournalForm({ ...journalForm, pair: e.target.value.toUpperCase() })}
                      placeholder="EUR/USD"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Direction *</label>
                    <select
                      required
                      value={journalForm.direction}
                      onChange={(e) => setJournalForm({ ...journalForm, direction: e.target.value as 'buy' | 'sell' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    >
                      <option value="buy">Buy (Long)</option>
                      <option value="sell">Sell (Short)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Entry Price *</label>
                    <input
                      type="number"
                      required
                      step="0.00001"
                      value={journalForm.entryPrice}
                      onChange={(e) => setJournalForm({ ...journalForm, entryPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stop Loss *</label>
                    <input
                      type="number"
                      required
                      step="0.00001"
                      value={journalForm.stopLoss}
                      onChange={(e) => setJournalForm({ ...journalForm, stopLoss: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Take Profit *</label>
                    <input
                      type="number"
                      required
                      step="0.00001"
                      value={journalForm.takeProfit}
                      onChange={(e) => setJournalForm({ ...journalForm, takeProfit: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lot Size *</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      value={journalForm.lotSize}
                      onChange={(e) => setJournalForm({ ...journalForm, lotSize: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Result *</label>
                    <select
                      required
                      value={journalForm.result}
                      onChange={(e) => setJournalForm({ ...journalForm, result: e.target.value as 'win' | 'loss' | 'breakeven' | 'open' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    >
                      <option value="open">Open</option>
                      <option value="win">Win</option>
                      <option value="loss">Loss</option>
                      <option value="breakeven">Breakeven</option>
                    </select>
                  </div>

                  {journalForm.result !== 'open' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Profit/Loss ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={journalForm.profitLoss}
                        onChange={(e) => setJournalForm({ ...journalForm, profitLoss: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={journalForm.notes}
                    onChange={(e) => setJournalForm({ ...journalForm, notes: e.target.value })}
                    rows={4}
                    placeholder="What did you learn from this trade? Any observations?"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Screenshot (Optional)
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Upload a screenshot of your demo trading activity (JPG, JPEG, or PNG only, max 10MB)
                  </p>
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png"
                      onChange={handleScreenshotUpload}
                      disabled={uploadingScreenshot || isSubmitting}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    {uploadingScreenshot && (
                      <p className="text-sm text-blue-600 flex items-center">
                        <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></span>
                        Uploading screenshot...
                      </p>
                    )}
                    {uploadError && (
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                        {uploadError}
                      </p>
                    )}
                    {screenshotPreview && !uploadError && (
                      <div className="mt-2">
                        <div className="relative w-full h-48 rounded-lg overflow-hidden border border-gray-300">
                          <Image
                            src={screenshotPreview}
                            alt="Screenshot preview"
                            fill
                            className="object-contain"
                            onError={() => {
                              setUploadError('Failed to load image preview. Please try uploading again.');
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setScreenshotPreview(null);
                            setJournalForm({ ...journalForm, screenshot: '' });
                            setUploadError(null);
                          }}
                          disabled={isSubmitting}
                          className="mt-2 text-sm text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Remove screenshot
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowJournalModal(false);
                      setJournalForm({
                        pair: '',
                        direction: 'buy',
                        entryPrice: '',
                        stopLoss: '',
                        takeProfit: '',
                        lotSize: '',
                        result: 'open',
                        profitLoss: '',
                        notes: '',
                        screenshot: '',
                      });
                      setScreenshotPreview(null);
                      setUploadError(null);
                    }}
                    disabled={isSubmitting}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                        Saving...
                      </>
                    ) : (
                      'Save Trade'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}


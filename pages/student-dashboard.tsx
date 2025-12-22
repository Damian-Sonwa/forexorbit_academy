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
import SetupGuide from '@/components/student/SetupGuide';
import TodoList from '@/components/TodoList';
import RemindersPanel from '@/components/RemindersPanel';
import AIAssistant from '@/components/AIAssistant';
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
  notes?: string;
  screenshot?: string;
  aiFeedback?: {
    strengths: string[];
    mistakes: string[];
    suggestions: string[];
    riskReward: string;
  };
  createdAt: string;
}

type ActiveSection = 'guide' | 'live' | 'tasks' | 'journal' | 'reminders' | 'ai';

export default function StudentDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { connected } = useSocket();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<ActiveSection>('guide');
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [taskSubmissions, setTaskSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [journalEntries, setJournalEntries] = useState<TradeJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [editingJournalEntry, setEditingJournalEntry] = useState<TradeJournalEntry | null>(null);
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

  const handleEditJournalEntry = (entry: TradeJournalEntry) => {
    setEditingJournalEntry(entry);
    setJournalForm({
      pair: entry.pair,
      direction: entry.direction,
      entryPrice: entry.entryPrice.toString(),
      stopLoss: entry.stopLoss.toString(),
      takeProfit: entry.takeProfit.toString(),
      lotSize: entry.lotSize.toString(),
      result: entry.result,
      profitLoss: entry.profitLoss?.toString() || '',
      notes: entry.notes || '',
      screenshot: entry.screenshot || '',
    });
    if (entry.screenshot) {
      setScreenshotPreview(entry.screenshot);
    }
    setShowJournalModal(true);
  };

  const handleDeleteJournalEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this trade entry? This action cannot be undone.')) {
      return;
    }

    try {
      await apiClient.delete(`/demo-trading/journal/${entryId}`);
      await loadData();
      alert('Trade entry deleted successfully');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete trade entry';
      alert(errorMessage);
      console.error('Delete journal entry error:', error);
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

      if (editingJournalEntry) {
        // Update existing entry
        await apiClient.put(`/demo-trading/journal/${editingJournalEntry._id}`, entryData);
      } else {
        // Create new entry
        await apiClient.post('/demo-trading/journal', entryData);
      }
      
      // Reset form and close modal
      setShowJournalModal(false);
      setEditingJournalEntry(null);
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:ml-0 pt-14 lg:pt-6 overflow-y-auto w-full">
          {/* Hero Header Section */}
          <div className="mb-8">
            <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 rounded-2xl shadow-2xl p-8 text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-black opacity-10"></div>
              <div className="relative z-10">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100">
                      Trading Dashboard
                    </h1>
                    <p className="text-blue-100 text-lg md:text-xl">
                      Master Forex trading with live practice, instructor tasks, and trade analysis
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-3">
                    <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
                    <span className="text-sm font-medium">
                      {connected ? 'Live Data Connected' : 'Connecting...'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-32 -mt-32"></div>
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-white opacity-5 rounded-full -ml-24 -mb-24"></div>
            </div>
          </div>

          {/* Section Navigation Tabs - Enhanced Design */}
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-2">
              <nav className="flex space-x-2 overflow-x-auto" aria-label="Sections">
                <button
                  onClick={() => setActiveSection('guide')}
                  className={`
                    flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 whitespace-nowrap
                    ${activeSection === 'guide'
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <span className="text-lg">📖</span>
                  <span>Setup Guide</span>
                </button>
                <button
                  onClick={() => setActiveSection('live')}
                  className={`
                    flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 whitespace-nowrap
                    ${activeSection === 'live'
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <span className="text-lg">⚡</span>
                  <span>Live Trading</span>
                </button>
                <button
                  onClick={() => setActiveSection('tasks')}
                  className={`
                    flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 whitespace-nowrap relative
                    ${activeSection === 'tasks'
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <span className="text-lg">📋</span>
                  <span>Tasks</span>
                  {pendingTasks.length > 0 && (
                    <span className="ml-2 px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full animate-pulse">
                      {pendingTasks.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveSection('journal')}
                  className={`
                    flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 whitespace-nowrap
                    ${activeSection === 'journal'
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <span className="text-lg">📊</span>
                  <span>Trade Journal</span>
                </button>
                <button
                  onClick={() => setActiveSection('reminders')}
                  className={`
                    flex items-center space-x-2 px-4 sm:px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 whitespace-nowrap
                    ${activeSection === 'reminders'
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <span className="text-lg">⏰</span>
                  <span className="hidden sm:inline">Reminders & To-Do</span>
                  <span className="sm:hidden">Reminders</span>
                </button>
                <button
                  onClick={() => setActiveSection('ai')}
                  className={`
                    flex items-center space-x-2 px-4 sm:px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 whitespace-nowrap
                    ${activeSection === 'ai'
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <span className="text-lg">🤖</span>
                  <span className="hidden sm:inline">AI Assistant</span>
                  <span className="sm:hidden">AI</span>
                </button>
              </nav>
            </div>
          </div>

          {/* Section Content - Enhanced with better spacing and design */}
          <div className="space-y-6">
            {/* Setup Guide Section */}
            {activeSection === 'guide' && (
              <div className="animate-in fade-in duration-300">
                <SetupGuide />
              </div>
            )}

            {/* Live Trading Section */}
            {activeSection === 'live' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="bg-gradient-to-r from-red-50 to-orange-50 border-l-4 border-red-500 rounded-xl p-6 shadow-md">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                        <span className="text-2xl">⚠️</span>
                      </div>
                    </div>
                    <div className="ml-4 flex-1">
                      <h3 className="text-lg font-bold text-red-900 mb-2">Critical Security Notice</h3>
                      <div className="space-y-2 text-sm text-red-800">
                        <p className="font-semibold">This is a DEMO trading interface using paper trading only.</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>All trades are executed in demo/paper trading mode with virtual money</li>
                          <li>No real money can be deposited, traded, or withdrawn</li>
                          <li>ForexOrbit Academy does not provide brokerage services</li>
                          <li>This feature is for educational purposes only. Trading involves substantial risk.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Market Signals */}
                <div className="transform transition-all hover:scale-[1.01]">
                  <MarketSignal />
                </div>

                {/* Trading Interface */}
                <div className="transform transition-all hover:scale-[1.01]">
                  <TradingInterface />
                </div>
              </div>
            )}

            {/* Tasks Section */}
            {activeSection === 'tasks' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                      <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                        Demo Trading Tasks
                      </h2>
                      <p className="text-gray-600">Complete tasks assigned by your instructor and submit for review</p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary-600">{pendingTasks.length}</div>
                        <div className="text-xs text-gray-500">Pending</div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-green-600">{submittedTasks.length}</div>
                        <div className="text-xs text-gray-500">Submitted</div>
                      </div>
                    </div>
                  </div>

                  {/* Pending Tasks */}
                  {pendingTasks.length > 0 && (
                    <div className="mb-8">
                      <div className="flex items-center space-x-3 mb-6">
                        <div className="w-1 h-8 bg-gradient-to-b from-yellow-400 to-orange-500 rounded-full"></div>
                        <h3 className="text-xl font-bold text-gray-900">Pending Tasks</h3>
                        <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold">
                          {pendingTasks.length}
                        </span>
                      </div>
                      <div className="grid gap-4">
                        {pendingTasks.map((task) => {
                          const status = getTaskStatus(task);
                          return (
                            <div 
                              key={task._id} 
                              className="group bg-gradient-to-br from-white to-gray-50 border-2 border-gray-200 rounded-2xl p-6 hover:shadow-xl hover:border-primary-300 transition-all duration-300 transform hover:-translate-y-1"
                            >
                              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                                <div className="flex-1">
                                  <div className="flex flex-wrap items-center gap-3 mb-3">
                                    <h4 className="text-xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors">
                                      {task.title}
                                    </h4>
                                    {task.level && (
                                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                        task.level === 'beginner' ? 'bg-green-100 text-green-700 border border-green-300' :
                                        task.level === 'intermediate' ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' :
                                        'bg-red-100 text-red-700 border border-red-300'
                                      }`}>
                                        {task.level.charAt(0).toUpperCase() + task.level.slice(1)}
                                      </span>
                                    )}
                                    <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-bold border border-yellow-300">
                                      {status.charAt(0).toUpperCase() + status.slice(1)}
                                    </span>
                                  </div>
                                  <p className="text-gray-600 mb-4 leading-relaxed">{task.description}</p>
                                  {task.instructions && (
                                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-lg p-4 mb-4">
                                      <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{task.instructions}</p>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-400">👤</span>
                                      <span>Assigned by: <strong>{task.assignedByName || 'Instructor'}</strong></span>
                                    </div>
                                    {task.dueDate && (
                                      <div className="flex items-center space-x-1">
                                        <span className="text-gray-400">📅</span>
                                        <span>Due: <strong>{format(new Date(task.dueDate), 'MMM dd, yyyy')}</strong></span>
                                      </div>
                                    )}
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-400">🕐</span>
                                      <span>Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex-shrink-0">
                                  <Link
                                    href={`/student-dashboard/tasks/${task._id}`}
                                    className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                                  >
                                    <span>View Task</span>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
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
                    <div className={pendingTasks.length > 0 ? 'mt-8' : ''}>
                      <div className="flex items-center space-x-3 mb-6">
                        <div className="w-1 h-8 bg-gradient-to-b from-green-400 to-emerald-500 rounded-full"></div>
                        <h3 className="text-xl font-bold text-gray-900">Submitted Tasks</h3>
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold">
                          {submittedTasks.length}
                        </span>
                      </div>
                      <div className="grid gap-4">
                        {submittedTasks.map((task) => {
                          const submission = taskSubmissions[task._id];
                          const status = getTaskStatus(task);
                          return (
                            <div 
                              key={task._id} 
                              className="bg-gradient-to-br from-white to-gray-50 border-2 border-gray-200 rounded-2xl p-6 hover:shadow-xl transition-all duration-300"
                            >
                              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                                <div className="flex-1">
                                  <div className="flex flex-wrap items-center gap-3 mb-3">
                                    <h4 className="text-xl font-bold text-gray-900">{task.title}</h4>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                      status === 'graded' ? 'bg-green-100 text-green-700 border border-green-300' :
                                      status === 'reviewed' ? 'bg-blue-100 text-blue-700 border border-blue-300' :
                                      'bg-yellow-100 text-yellow-700 border border-yellow-300'
                                    }`}>
                                      {status.charAt(0).toUpperCase() + status.slice(1)}
                                    </span>
                                  </div>
                                  <p className="text-gray-600 mb-4">{task.description}</p>
                                  {submission && (
                                    <div className="space-y-3">
                                      {submission.grade && (
                                        <div className="flex items-center gap-3">
                                          <span className="text-sm font-semibold text-gray-700">Grade:</span>
                                          <span className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl text-lg font-bold shadow-md">
                                            {submission.grade}
                                          </span>
                                        </div>
                                      )}
                                      {submission.feedback && (
                                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-l-4 border-green-500 rounded-lg p-4">
                                          <p className="text-sm font-bold text-green-800 mb-2">💬 Instructor Feedback:</p>
                                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{submission.feedback}</p>
                                        </div>
                                      )}
                                      {submission.reviewedAt && (
                                        <p className="text-xs text-gray-500 flex items-center space-x-1">
                                          <span>🕐</span>
                                          <span>Reviewed: {format(new Date(submission.reviewedAt), 'MMM dd, yyyy HH:mm')}</span>
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="flex-shrink-0">
                                  <Link
                                    href={`/student-dashboard/tasks/${task._id}`}
                                    className="inline-flex items-center space-x-2 px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl transition-all duration-200"
                                  >
                                    <span>View Details</span>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
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
                    <div className="text-center py-16 bg-white rounded-2xl border-2 border-dashed border-gray-300">
                      <div className="text-6xl mb-4">📋</div>
                      <p className="text-xl font-semibold text-gray-700 mb-2">No tasks assigned yet</p>
                      <p className="text-gray-500">Your instructor will assign practice tasks here.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Trade Journal Section */}
            {activeSection === 'journal' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                      <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                        Trade Journal
                      </h2>
                      <p className="text-gray-600">Track your trading performance and learn from each trade</p>
                    </div>
                    <button
                      onClick={() => setShowJournalModal(true)}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Add Trade</span>
                    </button>
                  </div>

                  {/* Open Trades */}
                  {openTrades.length > 0 && (
                    <div className="mb-8">
                      <div className="flex items-center space-x-3 mb-6">
                        <div className="w-1 h-8 bg-gradient-to-b from-blue-400 to-cyan-500 rounded-full"></div>
                        <h3 className="text-xl font-bold text-gray-900">Open Trades</h3>
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">
                          {openTrades.length}
                        </span>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                            <tr>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Pair</th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Direction</th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Entry</th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">SL</th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">TP</th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Lot Size</th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Date</th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {openTrades.map((trade) => (
                              <tr key={trade._id} className="hover:bg-blue-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{trade.pair}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                                    trade.direction === 'buy' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'
                                  }`}>
                                    {trade.direction.toUpperCase()}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{trade.entryPrice}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{trade.stopLoss}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{trade.takeProfit}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{trade.lotSize}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{format(new Date(trade.createdAt), 'MMM dd, yyyy')}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                  <div className="flex items-center space-x-2">
                                    <button
                                      onClick={() => handleEditJournalEntry(trade)}
                                      className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                                      title="Edit"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => handleDeleteJournalEntry(trade._id)}
                                      className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                                      title="Delete"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Closed Trades */}
                  {closedTrades.length > 0 && (
                    <div className={openTrades.length > 0 ? 'mt-8' : ''}>
                      <div className="flex items-center space-x-3 mb-6">
                        <div className="w-1 h-8 bg-gradient-to-b from-purple-400 to-pink-500 rounded-full"></div>
                        <h3 className="text-xl font-bold text-gray-900">Closed Trades</h3>
                        <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-bold">
                          {closedTrades.length}
                        </span>
                      </div>
                      <div className="grid gap-4">
                        {closedTrades.map((trade) => (
                          <div 
                            key={trade._id} 
                            className="bg-gradient-to-br from-white to-gray-50 border-2 border-gray-200 rounded-2xl p-6 hover:shadow-xl transition-all duration-300"
                          >
                            <div className="grid md:grid-cols-6 gap-6 items-center mb-4">
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pair</p>
                                <p className="text-lg font-bold text-gray-900">{trade.pair}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Direction</p>
                                <span className={`inline-block px-3 py-1.5 rounded-full text-xs font-bold ${
                                  trade.direction === 'buy' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'
                                }`}>
                                  {trade.direction.toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Entry</p>
                                <p className="text-lg font-bold text-gray-900">{trade.entryPrice}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Result</p>
                                <span className={`inline-block px-3 py-1.5 rounded-full text-xs font-bold ${
                                  trade.result === 'win' ? 'bg-green-100 text-green-700 border border-green-300' :
                                  trade.result === 'loss' ? 'bg-red-100 text-red-700 border border-red-300' :
                                  'bg-gray-100 text-gray-700 border border-gray-300'
                                }`}>
                                  {trade.result.toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">P/L</p>
                                <p className={`text-lg font-bold ${
                                  trade.profitLoss && trade.profitLoss > 0 ? 'text-green-600' :
                                  trade.profitLoss && trade.profitLoss < 0 ? 'text-red-600' : 'text-gray-900'
                                }`}>
                                  {trade.profitLoss !== undefined ? `$${trade.profitLoss.toFixed(2)}` : '-'}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date</p>
                                <p className="text-sm text-gray-600">{format(new Date(trade.createdAt), 'MMM dd, yyyy')}</p>
                              </div>
                            </div>
                            {(trade.notes || trade.screenshot || trade.aiFeedback) && (
                              <div className="mt-6 pt-6 border-t-2 border-gray-200">
                                {trade.notes && (
                                  <div className="mb-4">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">📝 Notes</p>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-4">{trade.notes}</p>
                                  </div>
                                )}
                                {trade.screenshot && (
                                  <div className="mb-4">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">📷 Screenshot</p>
                                    <div className="relative w-full max-w-md h-64 rounded-xl overflow-hidden border-2 border-gray-300 shadow-md">
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
                                {trade.aiFeedback && (
                                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-lg p-4 mb-4">
                                    <div className="flex items-center mb-3">
                                      <span className="text-lg mr-2">🤖</span>
                                      <h4 className="text-sm font-bold text-gray-900">AI Feedback</h4>
                                    </div>
                                    {trade.aiFeedback.strengths && trade.aiFeedback.strengths.length > 0 && (
                                      <div className="mb-3">
                                        <p className="text-xs font-semibold text-green-700 mb-1">✅ Strengths:</p>
                                        <ul className="list-disc list-inside space-y-1">
                                          {trade.aiFeedback.strengths.map((strength, idx) => (
                                            <li key={idx} className="text-xs text-gray-700">{strength}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {trade.aiFeedback.mistakes && trade.aiFeedback.mistakes.length > 0 && (
                                      <div className="mb-3">
                                        <p className="text-xs font-semibold text-orange-700 mb-1">⚠️ Areas for Improvement:</p>
                                        <ul className="list-disc list-inside space-y-1">
                                          {trade.aiFeedback.mistakes.map((mistake, idx) => (
                                            <li key={idx} className="text-xs text-gray-700">{mistake}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {trade.aiFeedback.suggestions && trade.aiFeedback.suggestions.length > 0 && (
                                      <div className="mb-3">
                                        <p className="text-xs font-semibold text-blue-700 mb-1">💡 Suggestions:</p>
                                        <ul className="list-disc list-inside space-y-1">
                                          {trade.aiFeedback.suggestions.map((suggestion, idx) => (
                                            <li key={idx} className="text-xs text-gray-700">{suggestion}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {trade.aiFeedback.riskReward && (
                                      <div>
                                        <p className="text-xs font-semibold text-purple-700 mb-1">📊 Risk-to-Reward:</p>
                                        <p className="text-xs text-gray-700">{trade.aiFeedback.riskReward}</p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="mt-4 pt-4 border-t-2 border-gray-200 flex justify-end space-x-2">
                              <button
                                onClick={() => handleEditJournalEntry(trade)}
                                className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-all"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={() => handleDeleteJournalEntry(trade._id)}
                                className="inline-flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-all"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Delete</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {journalEntries.length === 0 && (
                    <div className="text-center py-16 bg-white rounded-2xl border-2 border-dashed border-gray-300">
                      <div className="text-6xl mb-4">📊</div>
                      <p className="text-xl font-semibold text-gray-700 mb-2">No trades logged yet</p>
                      <p className="text-gray-500 mb-6">Start tracking your trading performance</p>
                      <button
                        onClick={() => setShowJournalModal(true)}
                        className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>Log Your First Trade</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reminders & To-Do Section */}
            {activeSection === 'reminders' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                {/* Section Header */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
                    Reminders & To-Do List
                  </h2>
                  <p className="text-gray-600">Manage your reminders and track your tasks</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Reminders Panel */}
                  <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                    <RemindersPanel />
                  </div>

                  {/* To-Do List */}
                  <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                    <TodoList />
                  </div>
                </div>
              </div>
            )}

            {/* AI Assistant Section */}
            {activeSection === 'ai' && (
              <div className="animate-in fade-in duration-300">
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 mb-6">
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent mb-2">
                    AI Learning Assistant
                  </h2>
                  <p className="text-gray-600">Get instant help with Forex concepts, lessons, and trading questions</p>
                </div>
                <AIAssistant />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Trade Journal Modal - Enhanced Design */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto transform transition-all animate-in zoom-in-95 duration-200">
            <div className="sticky top-0 bg-gradient-to-r from-primary-600 to-purple-600 text-white p-6 rounded-t-2xl">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold mb-1">{editingJournalEntry ? 'Edit Trade' : 'Log Trade'}</h2>
                  <p className="text-primary-100 text-sm">{editingJournalEntry ? 'Update your trade entry' : 'Record your trading activity and analysis'}</p>
                </div>
                <button
                  onClick={() => {
                    setShowJournalModal(false);
                    setEditingJournalEntry(null);
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
                  className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6">

              <form onSubmit={handleSubmitJournal} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Currency Pair *</label>
                    <input
                      type="text"
                      required
                      value={journalForm.pair}
                      onChange={(e) => setJournalForm({ ...journalForm, pair: e.target.value.toUpperCase() })}
                      placeholder="EUR/USD"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-gray-900 bg-white transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Direction *</label>
                    <select
                      required
                      value={journalForm.direction}
                      onChange={(e) => setJournalForm({ ...journalForm, direction: e.target.value as 'buy' | 'sell' })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-gray-900 bg-white transition-all"
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

                <div className="flex justify-end space-x-4 pt-6 border-t-2 border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setShowJournalModal(false);
                      setEditingJournalEntry(null);
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
                    className="px-6 py-3 border-2 border-gray-300 rounded-xl text-gray-700 font-bold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-all transform hover:scale-105"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <span>💾</span>
                        <span>Save Trade</span>
                      </>
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


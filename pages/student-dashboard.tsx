/**
 * Student Dashboard
 * Sections: Setup guide, Practice account, Tasks, Trade journal (reviews of closed simulator trades)
 * and Reminders.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import LoadingSpinner from '@/components/LoadingSpinner';
import TradingInterface from '@/components/TradingInterface';
import StudentPracticalTasks from '@/components/practical/StudentTasks';
import SetupGuide from '@/components/student/SetupGuide';
import TradeReviews from '@/components/student/TradeReviews';
import TodoList from '@/components/TodoList';
import RemindersPanel from '@/components/RemindersPanel';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import { AlertTriangle, BarChart3, BookOpen, Calendar, ClipboardList, Clock, MessageSquare, User, Zap } from 'lucide-react';

// The market signal chart pulls in recharts; load it after the page instead of in the page bundle.

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

/** Entries from the old hand-typed journal, shown read-only. */
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

type ActiveSection = 'guide' | 'live' | 'tasks' | 'journal' | 'reminders';

export default function StudentDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { connected } = useSocket();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<ActiveSection>('live');
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [taskSubmissions, setTaskSubmissions] = useState<Record<string, TaskSubmission>>({});
  const [journalEntries, setJournalEntries] = useState<TradeJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);


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

  // Deep links: ?section=tasks|live|journal|guide|reminders (a practical task opens the desk with ?section=live).
  const sectionParam = typeof router.query.section === 'string' ? router.query.section : '';
  useEffect(() => {
    if (['guide', 'live', 'tasks', 'journal', 'reminders'].includes(sectionParam)) setActiveSection(sectionParam as ActiveSection);
  }, [sectionParam]);
  const deskInstrument = typeof router.query.instrument === 'string' ? router.query.instrument : undefined;
  const deskTask = typeof router.query.task === 'string' && /^[a-f0-9]{24}$/.test(router.query.task) ? router.query.task : null;

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
          console.error('Failed to load submissions:');
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard data:');
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

  if (authLoading || loading) {
    return <LoadingSpinner message="Loading dashboard..." fullScreen />;
  }

  if (!isAuthenticated || user?.role !== 'student') {
    return null;
  }

  const pendingTasks = tasks.filter(t => getTaskStatus(t) === 'pending');
  const submittedTasks = tasks.filter(t => getTaskStatus(t) === 'submitted' || getTaskStatus(t) === 'reviewed' || getTaskStatus(t) === 'graded');

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="page-kicker">Practice</p>
              <h1 className="page-title mt-3">Practice desk</h1>
              <p className="page-lede">
                Paper trading, instructor tasks, and a journal. No real money is deposited or withdrawn.
              </p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-muted shadow-panel">
              <span className={`relative flex h-2 w-2`}>
                {connected && <span className="absolute inline-flex h-full w-full rounded-full bg-up opacity-60 motion-safe:animate-ping" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-up' : 'bg-[var(--fo-line-strong)]'}`} />
              </span>
              {connected ? 'Connected' : 'Connecting'}
            </div>
          </div>

          <div className="mb-6">
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface-1 p-1.5 shadow-panel">
              <nav className="flex min-w-max gap-1" aria-label="Sections">
                <button
                  onClick={() => setActiveSection('guide')}
                  aria-current={activeSection === 'guide' ? 'page' : undefined}
                  className={`
                    relative flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-colors
                    ${activeSection === 'guide'
                      ? 'bg-tint text-ink after:absolute after:inset-x-4 after:-bottom-px after:h-px after:bg-[linear-gradient(90deg,transparent,#ff7012,transparent)]'
                      : 'text-ink-muted hover:bg-[color-mix(in_srgb,var(--fo-text)_5%,transparent)] hover:text-ink'
                    }
                  `}
                >
                  <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
                  <span>Setup Guide</span>
                </button>
                <button
                  onClick={() => setActiveSection('live')}
                  aria-current={activeSection === 'live' ? 'page' : undefined}
                  className={`
                    relative flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-colors
                    ${activeSection === 'live'
                      ? 'bg-tint text-ink after:absolute after:inset-x-4 after:-bottom-px after:h-px after:bg-[linear-gradient(90deg,transparent,#ff7012,transparent)]'
                      : 'text-ink-muted hover:bg-[color-mix(in_srgb,var(--fo-text)_5%,transparent)] hover:text-ink'
                    }
                  `}
                >
                  <Zap className="h-4 w-4 shrink-0" aria-hidden />
                  <span>Practice account</span>
                </button>
                <button
                  onClick={() => setActiveSection('tasks')}
                  aria-current={activeSection === 'tasks' ? 'page' : undefined}
                  className={`
                    relative flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-colors
                    ${activeSection === 'tasks'
                      ? 'bg-tint text-ink after:absolute after:inset-x-4 after:-bottom-px after:h-px after:bg-[linear-gradient(90deg,transparent,#ff7012,transparent)]'
                      : 'text-ink-muted hover:bg-[color-mix(in_srgb,var(--fo-text)_5%,transparent)] hover:text-ink'
                    }
                  `}
                >
                  <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
                  <span>Tasks</span>
                  {pendingTasks.length > 0 && (
                    <span className="ml-1 rounded-full bg-primary-500 px-2 py-0.5 text-[11px] font-bold leading-none text-neutral-950">
                      {pendingTasks.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveSection('journal')}
                  aria-current={activeSection === 'journal' ? 'page' : undefined}
                  className={`
                    relative flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-colors
                    ${activeSection === 'journal'
                      ? 'bg-tint text-ink after:absolute after:inset-x-4 after:-bottom-px after:h-px after:bg-[linear-gradient(90deg,transparent,#ff7012,transparent)]'
                      : 'text-ink-muted hover:bg-[color-mix(in_srgb,var(--fo-text)_5%,transparent)] hover:text-ink'
                    }
                  `}
                >
                  <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
                  <span>Trade Journal</span>
                </button>
                <button
                  onClick={() => setActiveSection('reminders')}
                  aria-current={activeSection === 'reminders' ? 'page' : undefined}
                  className={`
                    relative flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-colors
                    ${activeSection === 'reminders'
                      ? 'bg-tint text-ink after:absolute after:inset-x-4 after:-bottom-px after:h-px after:bg-[linear-gradient(90deg,transparent,#ff7012,transparent)]'
                      : 'text-ink-muted hover:bg-[color-mix(in_srgb,var(--fo-text)_5%,transparent)] hover:text-ink'
                    }
                  `}
                >
                  <Clock className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="hidden sm:inline">Reminders & To-Do</span>
                  <span className="sm:hidden">Reminders</span>
                </button>
              </nav>
            </div>
          </div>

          {/* Section Content - Enhanced with better spacing and design */}
          <div className="space-y-6">
            {/* Setup Guide Section */}
            {activeSection === 'guide' && (
              <div className="animate-in fade-in duration-300">
                <SetupGuide onNavigate={setActiveSection} />
              </div>
            )}

            {/* Live Trading Section */}
            {activeSection === 'live' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="notice notice-caution !p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--fo-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--fo-warn)_12%,transparent)]">
                      <AlertTriangle className="h-5 w-5 shrink-0 text-caution" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-ink">Practice simulator notice</h3>
                      <div className="mt-1 space-y-2 text-sm text-ink-muted">
                        <p className="font-medium text-ink">This is a practice simulator. No order reaches a broker or a real market.</p>
                        <ul className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 [&>li]:relative [&>li]:pl-4 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[0.6em] [&>li]:before:h-1.5 [&>li]:before:w-1.5 [&>li]:before:rounded-full [&>li]:before:border [&>li]:before:border-[var(--fo-warn)]">
                          <li>All trades are simulated on this site with virtual money</li>
                          <li>No real money can be deposited, traded, or withdrawn</li>
                          <li>ForexOrbit Academy does not provide brokerage services</li>
                          <li>This feature is for educational purposes only. Trading involves substantial risk.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {deskTask && (
                  <div className="notice notice-brand flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="task-desk-banner">
                    <span><span className="font-semibold text-ink">Working on a practical task.</span> Trades you open now can be attached to it. Prices are simulated, not live.</span>
                    <Link href={`/student-dashboard/practical/${deskTask}`} className="btn btn-secondary btn-sm">Back to the task</Link>
                  </div>
                )}
                <TradingInterface initialInstrument={deskInstrument} />
              </div>
            )}

            {/* Tasks Section */}
            {activeSection === 'tasks' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <StudentPracticalTasks />
                {/* Older free-form demo tasks, shown only while a student still has some. */}
                {tasks.length > 0 && (
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                      <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
                        Earlier demo tasks
                      </h2>
                      <p className="text-gray-600">Free-form tasks set before practical tasks were introduced</p>
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
                        <div className="w-1 h-8 bg-primary-500 rounded-full"></div>
                        <h3 className="text-xl font-bold text-gray-900">Pending Tasks</h3>
                        <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold dark:bg-amber-400/15 dark:text-amber-200 dark:border-amber-400/30">
                          {pendingTasks.length}
                        </span>
                      </div>
                      <div className="grid gap-4">
                        {pendingTasks.map((task) => {
                          const status = getTaskStatus(task);
                          return (
                            <div 
                              key={task._id} 
                              className="group bg-white border-2 border-gray-200 rounded-2xl p-6 hover:border-primary-300 transition-colors"
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
                                    <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-bold border border-yellow-300 dark:bg-amber-400/15 dark:text-amber-200 dark:border-amber-400/30">
                                      {status.charAt(0).toUpperCase() + status.slice(1)}
                                    </span>
                                  </div>
                                  <p className="text-gray-600 mb-4 leading-relaxed">{task.description}</p>
                                  {task.instructions && (
                                    <div className="bg-neutral-50 border-l-4 border-primary-600 rounded-lg p-4 mb-4">
                                      <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{task.instructions}</p>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                    <div className="flex items-center space-x-1">
                                      <User className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                                      <span>Assigned by: <strong>{task.assignedByName || 'Instructor'}</strong></span>
                                    </div>
                                    {task.dueDate && (
                                      <div className="flex items-center space-x-1">
                                        <Calendar className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                                        <span>Due: <strong>{format(new Date(task.dueDate), 'MMM dd, yyyy')}</strong></span>
                                      </div>
                                    )}
                                    <div className="flex items-center space-x-1">
                                      <Clock className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                                      <span>Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex-shrink-0">
                                  <Link
                                    href={`/student-dashboard/tasks/${task._id}`}
                                    className="inline-flex items-center space-x-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-bold transition-colors"
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
                        <div className="w-1 h-8 bg-green-600 rounded-full"></div>
                        <h3 className="text-xl font-bold text-gray-900">Submitted Tasks</h3>
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold dark:bg-emerald-400/15 dark:text-emerald-200">
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
                              className="bg-white border-2 border-gray-200 rounded-2xl p-6 transition-colors"
                            >
                              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                                <div className="flex-1">
                                  <div className="flex flex-wrap items-center gap-3 mb-3">
                                    <h4 className="text-xl font-bold text-gray-900">{task.title}</h4>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                      status === 'graded' ? 'bg-green-100 text-green-700 border border-green-300' :
                                      status === 'reviewed' ? 'bg-neutral-100 text-primary-700 border border-neutral-300' :
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
                                        <div className="bg-neutral-50 border-l-4 border-green-500 rounded-lg p-4">
                                          <p className="text-sm font-bold text-green-800 mb-2"><MessageSquare className="mr-2 inline h-4 w-4 shrink-0 text-neutral-600" aria-hidden />Instructor Feedback:</p>
                                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{submission.feedback}</p>
                                        </div>
                                      )}
                                      {submission.reviewedAt && (
                                        <p className="text-xs text-gray-500 flex items-center space-x-1">
                                          <Clock className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
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

                </div>
                )}
              </div>
            )}

            {/* Trade journal: reviews of closed simulator trades (components/student/TradeReviews.tsx) */}
            {activeSection === 'journal' && (
              <TradeReviews tasks={tasks} legacyEntries={journalEntries} onOpenDesk={() => setActiveSection('live')} />
            )}

            {/* Reminders & To-Do Section */}
            {activeSection === 'reminders' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                {/* Section Header */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                  <h2 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">
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
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
}


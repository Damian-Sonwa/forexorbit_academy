/**
 * Student Dashboard
 * Practice desk. Sections: Trade, Tasks, Journal (reviews of closed simulator trades), Results,
 * Planner (reminders and to-do) and the Guide, which holds the explanations.
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
import { BarChart3, BookOpen, CalendarCheck, ClipboardList, NotebookPen, Zap } from 'lucide-react';

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

type ActiveSection = 'live' | 'tasks' | 'journal' | 'results' | 'reminders' | 'guide';
const SECTIONS: Array<{ id: ActiveSection; label: string; icon: typeof Zap }> = [
  { id: 'live', label: 'Trade', icon: Zap },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'journal', label: 'Journal', icon: NotebookPen },
  { id: 'results', label: 'Results', icon: BarChart3 },
  { id: 'reminders', label: 'Planner', icon: CalendarCheck },
  { id: 'guide', label: 'Guide', icon: BookOpen },
];

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

  // Deep links: ?section=tasks|live|journal|results|guide|reminders (a practical task opens the desk with ?section=live).
  const sectionParam = typeof router.query.section === 'string' ? router.query.section : '';
  useEffect(() => {
    if (['guide', 'live', 'tasks', 'journal', 'results', 'reminders'].includes(sectionParam)) setActiveSection(sectionParam as ActiveSection);
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

        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 pb-12 pt-16 sm:px-6 lg:px-10 lg:pt-8">
          <div className="flex items-center justify-between gap-4">
            <h1 className="page-title">Practice desk</h1>
            <span className="inline-flex items-center gap-2 text-xs font-medium text-ink-muted" role="status">
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-up' : 'bg-[var(--fo-line-strong)]'}`} aria-hidden />
              {connected ? 'Connected' : 'Connecting'}
            </span>
          </div>

          <div className="-mx-4 mb-5 mt-4 overflow-x-auto overflow-y-hidden border-b border-line px-4 sm:mx-0 sm:px-0">
            <nav className="flex min-w-max gap-1" aria-label="Practice desk">
              {SECTIONS.map(({ id, label, icon: Icon }) => {
                const current = activeSection === id;
                return (
                  <button key={id} type="button" onClick={() => setActiveSection(id)} aria-current={current ? 'page' : undefined} className={`-mb-px inline-flex min-h-[48px] items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors sm:px-4 ${current ? 'border-primary-500 text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
                    <Icon className={`h-4 w-4 shrink-0 ${current ? 'text-primary-600 dark:text-primary-400' : ''}`} aria-hidden />
                    {label}
                    {id === 'tasks' && pendingTasks.length > 0 && <span className="rounded-full bg-primary-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-neutral-950">{pendingTasks.length}<span className="sr-only"> pending</span></span>}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Trade and Results share one desk, so it keeps its state between the two. */}
          {(activeSection === 'live' || activeSection === 'results') && (
            <div className="space-y-4">
              {deskTask && activeSection === 'live' && (
                <div className="notice notice-brand flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="task-desk-banner">
                  <span><span className="font-semibold text-ink">Working on a practical task.</span> Trades you open now can be attached to it. Prices are simulated, not live.</span>
                  <Link href={`/student-dashboard/practical/${deskTask}`} className="btn btn-secondary btn-sm">Back to the task</Link>
                </div>
              )}
              <TradingInterface initialInstrument={deskInstrument} panel={activeSection === 'results' ? 'results' : 'trade'} />
            </div>
          )}

          {activeSection === 'guide' && <SetupGuide onNavigate={setActiveSection} />}

          {activeSection === 'tasks' && (
            <div className="space-y-8">
              <StudentPracticalTasks />
              {/* Older free-form demo tasks, shown only while a student still has some. */}
              {tasks.length > 0 && (
                <section aria-labelledby="earlier-tasks">
                  <h2 id="earlier-tasks" className="section-title">Earlier demo tasks</h2>
                  <p className="mt-0.5 text-sm text-ink-muted">{pendingTasks.length} pending, {submittedTasks.length} submitted</p>
                  <ul className="mt-3 divide-y divide-[var(--fo-line)] overflow-hidden rounded-panel border border-line bg-surface-1">
                    {[...pendingTasks, ...submittedTasks].map((task) => {
                      const status = getTaskStatus(task);
                      const submission = taskSubmissions[task._id];
                      const facts = [task.assignedByName || 'Instructor', task.level, task.dueDate && status === 'pending' ? `due ${format(new Date(task.dueDate), 'MMM dd, yyyy')}` : null].filter(Boolean).join(' · ');
                      return (
                        <li key={task._id} className="px-4 py-4 sm:px-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink [overflow-wrap:anywhere]">{task.title}</span><span className={`chip ${status === 'graded' ? 'chip-up' : status === 'pending' ? 'chip-brand' : ''}`}>{status}</span>{submission?.grade != null && <span className="text-sm font-semibold text-ink num">Grade {submission.grade}</span>}</p>
                              <p className="mt-0.5 text-xs text-ink-subtle">{facts}</p>
                            </div>
                            <Link href={`/student-dashboard/tasks/${task._id}`} className={`btn min-h-[2.75rem] ${status === 'pending' ? 'btn-primary' : 'btn-secondary'}`}>{status === 'pending' ? 'Open task' : 'View details'}</Link>
                          </div>
                          {submission?.feedback && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm text-ink-muted"><span className="font-semibold text-ink">Instructor feedback: </span>{submission.feedback}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}

          {/* Trade journal: reviews of closed simulator trades (components/student/TradeReviews.tsx) */}
          {activeSection === 'journal' && (
            <TradeReviews tasks={tasks} legacyEntries={journalEntries} onOpenDesk={() => setActiveSection('live')} />
          )}

          {activeSection === 'reminders' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RemindersPanel />
              <TodoList />
            </div>
          )}
        </main>
      </div>

      <Footer />
    </div>
  );
}

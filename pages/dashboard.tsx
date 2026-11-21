/**
 * Student dashboard (Phase 11): progress, what to do next, assessments, milestones and practice
 * trading, from real records only.
 *
 * Layout: four tabs, one visible at a time (?tab= in the URL, so links and Back work).
 *   Overview     what to do now: welcome and Continue, four key figures, Up next, due soon, a
 *                practice snapshot and the latest activity. Secondary items sit in disclosures.
 *   Learning     learning activity chart, all courses, milestones.
 *   Assessments  everything upcoming, quiz performance, recent results and the score trend.
 *   Practice     the full practice trading analytics (SIMULATED).
 *
 * Data: one request, GET /api/student/dashboard (lib/student-analytics.js, hooks/useStudentDashboard),
 * shared by every tab. The learning range and the activity feed fetch their own slices; the
 * notifications disclosure uses the existing notifications API. Totals count active enrollments
 * only (the Phase 8 summary's rules: data.overview mirrors summary.totals). Staff are redirected as
 * before; the dashboard APIs refuse anyone but students.
 */

import { useEffect, useState } from 'react';
import PracticalTasksCard from '@/components/practical/TasksCard';
import { useRouter } from 'next/router';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { ChartSkeleton, LoadingStatus, MetricSkeleton, CourseCardSkeleton } from '@/components/loading';
import RemindersPanel from '@/components/RemindersPanel';
import { useAuth } from '@/hooks/useAuth';
import { useStudentDashboard } from '@/hooks/useStudentDashboard';
import { apiClient } from '@/lib/api-client';
import {
  ActivityList,
  AssessmentSummary,
  Disclosure,
  ErrorState,
  KeyFigures,
  Milestones,
  MyCourses,
  PracticeSnapshot,
  RecentScores,
  Recommendations,
  Section,
  UpcomingAssessments,
  WelcomeHero,
} from '@/components/student/dashboard/Panels';
import PracticePanel from '@/components/student/dashboard/PracticePanel';
import { ActivityFeed, LearningActivity, NotificationsPanel } from '@/components/student/dashboard/Live';

// Charts render on the client only (recharts measures the DOM).
const chartLoading = () => <ChartSkeleton />;
const LearningActivityChart = dynamic(() => import('@/components/student/dashboard/Charts').then((m) => m.LearningActivityChart), { ssr: false, loading: chartLoading });
const ScoreTrendChart = dynamic(() => import('@/components/student/dashboard/Charts').then((m) => m.ScoreTrendChart), { ssr: false, loading: chartLoading });
const PerformanceChart = dynamic(() => import('@/components/student/dashboard/Charts').then((m) => m.PerformanceChart), { ssr: false, loading: chartLoading });
const OutcomeChart = dynamic(() => import('@/components/student/dashboard/Charts').then((m) => m.OutcomeChart), { ssr: false, loading: chartLoading });
const InstrumentChart = dynamic(() => import('@/components/student/dashboard/Charts').then((m) => m.InstrumentChart), { ssr: false, loading: chartLoading });

interface UpcomingConsultation {
  _id: string;
  topic: string;
  lifecycle: string;
  startsAt?: string | null;
}

type Tab = 'overview' | 'learning' | 'assessments' | 'practice';
const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['learning', 'Learning'], ['assessments', 'Assessments'], ['practice', 'Practice']];
const isTab = (value: unknown): value is Tab => typeof value === 'string' && TABS.some(([id]) => id === value);
/** How much of each list the overview shows; the rest is one tab or one disclosure away. */
const OVERVIEW_LIMITS = { recommendations: 3, upcoming: 3, activity: 4 };

export default function Dashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const isStudent = Boolean(isAuthenticated && user?.role === 'student');
  const { data, loading, refreshing, error, refetch } = useStudentDashboard(isStudent);
  const [consultations, setConsultations] = useState<UpcomingConsultation[]>([]);
  const tab: Tab = isTab(router.query.tab) ? router.query.tab : 'overview';

  const openTab = (next: Tab) => {
    const query = { ...router.query };
    if (next === 'overview') delete query.tab;
    else query.tab = next;
    void router.push({ pathname: router.pathname, query }, undefined, { shallow: true, scroll: false });
    if (typeof window !== 'undefined') document.getElementById('dashboard-tabs')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user) {
      if (user.role === 'instructor') {
        if (user.status && user.status !== 'approved') {
          if (user.status === 'pending') {
            alert('Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.');
          } else if (user.status === 'rejected') {
            alert('Your registration has been rejected. Please contact support for more information.');
          }
          router.push('/login');
          return;
        }
        router.push('/instructor/dashboard');
        return;
      }
      if (user.role === 'admin' || user.role === 'superadmin') {
        if (user.role === 'admin' && user.status && user.status !== 'approved') {
          if (user.status === 'pending') {
            alert('Your registration is pending approval. Please wait for Super Admin approval before accessing your dashboard.');
          } else if (user.status === 'rejected') {
            alert('Your registration has been rejected. Please contact support for more information.');
          }
          router.push('/login');
          return;
        }
        router.push('/admin');
      }
    }
  }, [isAuthenticated, authLoading, user, router]);

  useEffect(() => {
    if (!isStudent) return;
    apiClient.get<UpcomingConsultation[]>('/consultations/requests')
      .then((rows) => {
        const upcoming = (Array.isArray(rows) ? rows : []).filter((row) => {
          if (!row.startsAt) return false;
          if (!['CONFIRMED', 'PENDING_CONFIRMATION', 'RESCHEDULE_REQUESTED'].includes(row.lifecycle)) return false;
          return new Date(row.startsAt).getTime() > Date.now() - 60 * 60 * 1000;
        });
        setConsultations(upcoming.slice(0, 3));
      })
      .catch(() => setConsultations([]));
  }, [isStudent]);

  if (authLoading || !isAuthenticated || !user || user.role !== 'student') {
    return <LoadingSpinner message="Checking your session" fullScreen />;
  }

  const firstName = user.name?.split(' ')[0] || null;
  const level = user.learningLevel || (user as { studentDetails?: { tradingLevel?: string } }).studentDetails?.tradingLevel;
  const levelChip = level ? (
    <span className="chip chip-brand !px-3 !py-1 text-xs">Level · {level}</span>
  ) : (
    <Link href="/onboarding" className="chip !px-3 !py-1 text-xs hover:border-primary-400 hover:text-ink">Set your level</Link>
  );

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-10">{content}</main>
      </div>
      <Footer />
    </div>
  );

  if (loading) {
    return shell(
      <div data-testid="dashboard-loading">
        <p className="page-kicker mb-2">Learning home</p>
        <h1 className="page-title">{firstName ? `Welcome back, ${firstName}` : 'Welcome back'}</h1>
        <div className="mt-8 space-y-8">
          <LoadingStatus label="Loading your dashboard" />
          <MetricSkeleton count={4} />
          <CourseCardSkeleton count={2} />
        </div>
      </div>
    );
  }

  if (!data) {
    return shell(
      <div className="panel-hero p-6 sm:p-8" data-testid="dashboard-error">
        <p className="page-kicker">Learning home</p>
        <h1 className="page-title mt-3">Progress could not be loaded</h1>
        <p className="page-lede">{error || 'Your dashboard is unavailable right now.'} Your enrollments and results are unchanged. Try again before treating this as an empty record.</p>
        <button type="button" onClick={() => void refetch()} className="btn btn-primary mt-5 rounded-full px-5">Try again</button>
      </div>
    );
  }

  const t = data.trading;
  const milestonesReached = data.milestones.filter((m) => m.achieved).length;
  const recentEvents = data.activity.events.slice(0, OVERVIEW_LIMITS.activity);
  const extras = consultations.length > 0;

  return shell(
    <div className="space-y-8">
      <WelcomeHero data={data} fallbackName={firstName} levelChip={levelChip} />

      {/* Tabs: scrollable on phones, sticky below the header. */}
      <div id="dashboard-tabs" className="sticky top-16 z-20 -mx-4 scroll-mt-24 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" aria-label="Dashboard" className="glass-panel inline-flex min-w-max gap-1 rounded-xl p-1">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => openTab(id)}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-medium transition-colors ${tab === id ? 'bg-surface-1 text-ink shadow-panel' : 'text-ink-muted hover:text-ink'}`}
            >
              {label}
              {id === 'assessments' && data.upcoming.total > 0 && <span className="ml-1.5 rounded-full bg-tint px-1.5 text-2xs font-semibold text-ink num">{data.upcoming.total}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorState text={`${error} Showing what was loaded before.`} onRetry={() => void refetch()} />}
      {refreshing && <LoadingStatus label="Updating your dashboard" compact />}

      {tab === 'overview' && (
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="space-y-8 animate-fade-in-fast">
          <KeyFigures overview={data.overview} weekMinutes={data.learning.recentMinutes} />

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-8">
              <Section title="Up next">
                {/* The hero already offers Continue, so it is not repeated here. */}
                <Recommendations items={data.recommendations} limit={OVERVIEW_LIMITS.recommendations} exclude={data.continue ? ['resume', 'unlock'] : []} />
              </Section>

              <Section title="Due soon" action={data.upcoming.total > 0 ? <button type="button" onClick={() => openTab('assessments')} className="btn btn-ghost btn-sm">All assessments</button> : undefined}>
                <UpcomingAssessments upcoming={data.upcoming} limit={OVERVIEW_LIMITS.upcoming} onViewAll={() => openTab('assessments')} />
              </Section>
            </div>

            <aside className="space-y-4" aria-label="Practice and activity">
              <PracticalTasksCard />
              <PracticeSnapshot trading={t} onOpen={() => openTab('practice')} />

              <section className="card !p-5" aria-labelledby="overview-activity">
                <h2 id="overview-activity" className="section-title mb-3">Recent activity</h2>
                <ActivityList events={recentEvents} />
              </section>

              {data.activity.events.length > OVERVIEW_LIMITS.activity && (
                <Disclosure title="More activity" testId="more-activity">
                  <ActivityFeed initial={data.activity.events} hasMore={data.activity.hasMore} />
                </Disclosure>
              )}
              <Disclosure title="Notifications" testId="notifications-disclosure">
                <NotificationsPanel bare />
              </Disclosure>
              <Disclosure title={extras ? 'Reminders and consultations' : 'Reminders'} hint={extras ? `${consultations.length} upcoming` : undefined} testId="reminders-disclosure">
                {extras && (
                  <ul className="mb-4 divide-y divide-[var(--fo-line)]">
                    {consultations.map((booking) => (
                      <li key={booking._id} className="flex items-center justify-between gap-4 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{booking.topic}</span>
                          <span className="block text-xs text-ink-subtle">{booking.startsAt ? new Date(booking.startsAt).toLocaleString() : ''}</span>
                        </span>
                        <Link href="/consultations" className="shrink-0 text-sm font-semibold text-primary-600 dark:text-primary-400">Open</Link>
                      </li>
                    ))}
                  </ul>
                )}
                <RemindersPanel />
              </Disclosure>
            </aside>
          </div>
        </div>
      )}

      {tab === 'learning' && (
        <div role="tabpanel" id="panel-learning" aria-labelledby="tab-learning" className="space-y-8 animate-fade-in-fast">
          <Section title="Learning activity">
            <LearningActivity initial={data.learning.series} Chart={LearningActivityChart} />
          </Section>
          <Section title="My courses" action={<Link href="/courses" className="btn btn-ghost btn-sm">Course library</Link>}>
            <MyCourses courses={data.courses} />
          </Section>
          <Disclosure title="Milestones" hint={`${milestonesReached} of ${data.milestones.length} reached`} testId="milestones-disclosure">
            <Milestones items={data.milestones} />
          </Disclosure>
        </div>
      )}

      {tab === 'assessments' && (
        <div role="tabpanel" id="panel-assessments" aria-labelledby="tab-assessments" className="space-y-8 animate-fade-in-fast">
          <Section title="Upcoming quizzes and assignments">
            <UpcomingAssessments upcoming={data.upcoming} />
          </Section>
          <Section title="Quiz performance" action={<Link href="/progress" className="btn btn-ghost btn-sm">Full history</Link>}>
            <AssessmentSummary a={data.assessments} retakes={data.upcoming.retakes} showRecent={false} />
          </Section>
          {data.assessments.attempts > 0 && (
            <div className="space-y-3">
              <Disclosure title="Recent results" hint={`last ${data.assessments.recent.length}`} defaultOpen testId="recent-results-disclosure">
                <RecentScores a={data.assessments} />
              </Disclosure>
              {data.assessments.trend.length > 1 && (
                <Disclosure title="Score trend" hint={`last ${data.assessments.trend.length} attempts`} testId="score-trend-disclosure">
                  <ScoreTrendChart trend={data.assessments.trend} />
                </Disclosure>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'practice' && (
        <div role="tabpanel" id="panel-practice" aria-labelledby="tab-practice" className="space-y-6 animate-fade-in-fast">
          <Section title="Practice trading" action={<Link href="/student-dashboard" className="btn btn-secondary btn-sm">Open practice desk</Link>}>
            <PracticePanel
              trading={t}
              charts={{
                performance: <PerformanceChart series={t.performance.series} />,
                outcome: <OutcomeChart wins={t.performance.wins} losses={t.performance.losses} breakeven={t.performance.breakeven} />,
                instrument: <InstrumentChart rows={t.performance.byInstrument} />,
              }}
            />
          </Section>
        </div>
      )}
    </div>
  );
}

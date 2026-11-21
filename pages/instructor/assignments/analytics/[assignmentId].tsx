/**
 * Assignment Analytics Page
 * Displays analytics for a specific assignment (instructor/admin only)
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { chartPalette, chartTooltipStyle } from '@/lib/chart-theme';
import { apiClient } from '@/lib/api-client';
import SubmissionGradeForm, { type GradeHistoryEntry } from '@/components/instructor/SubmissionGradeForm';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { format } from 'date-fns';

interface AnalyticsData {
  assignment: {
    _id: string;
    title: string;
    description: string;
    courseId: string;
    courseName: string;
    dueDate: string | null;
    points: number;
    createdAt: string;
  };
  summary: {
    totalStudents: number;
    totalSubmissions: number;
    gradedSubmissions: number;
    pendingGrading: number;
    submissionRate: number;
    averageScore: number;
    highestScore: number | null;
    lowestScore: number | null;
  };
  scoreDistribution: {
    '90-100': number;
    '80-89': number;
    '70-79': number;
    '60-69': number;
    '0-59': number;
  };
  submissionTimeline: Array<{
    date: string;
    count: number;
  }>;
  studentSubmissions: Array<{
    _id: string;
    userId: string;
    studentName: string;
    studentEmail: string;
    grade: number | null;
    submittedAt: string | null;
    status: string;
    feedback: string | null;
    late?: boolean;
    submissionText?: string;
    submissionFile?: string | null;
    gradeHistory?: GradeHistoryEntry[];
  }>;
}

const COLORS = ['#15803D', '#B85C0E', '#A16207', '#DC2626', '#171717'];

export default function AssignmentAnalytics() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const chart = chartPalette(useTheme().isDark);
  const router = useRouter();
  const { assignmentId } = router.query;
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState<string | null>(null);

  useEffect(() => {
    // Redirect students away
    if (!authLoading && isAuthenticated && user) {
      if (user.role === 'student') {
        router.push('/dashboard');
        return;
      }
      if (user.role !== 'instructor' && user.role !== 'admin' && user.role !== 'superadmin') {
        router.push('/dashboard');
        return;
      }
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (assignmentId && isAuthenticated && user && (user.role === 'instructor' || user.role === 'admin' || user.role === 'superadmin')) {
      loadAnalytics();
    }
  }, [assignmentId, isAuthenticated, user]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get(`/assignments/${assignmentId}/analytics`);
      setAnalytics(data as AnalyticsData);
    } catch (err: any) {
      console.error('Failed to load analytics:');
      setError(err.response?.data?.error || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (!isAuthenticated || !user || (user.role !== 'instructor' && user.role !== 'admin' && user.role !== 'superadmin')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-500 text-lg">Access Denied: You do not have permission to view this page.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-4 lg:p-8">
            <div className="max-w-7xl mx-auto">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
                <p className="text-red-600 dark:text-red-400">{error}</p>
                <button
                  onClick={() => router.back()}
                  className="btn btn-secondary mt-4"
                >
                  Go Back
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-ink-muted">No analytics data available</p>
      </div>
    );
  }

  // Prepare score distribution data for chart
  const scoreDistributionData = [
    { range: '90-100', count: analytics.scoreDistribution['90-100'] },
    { range: '80-89', count: analytics.scoreDistribution['80-89'] },
    { range: '70-79', count: analytics.scoreDistribution['70-79'] },
    { range: '60-69', count: analytics.scoreDistribution['60-69'] },
    { range: '0-59', count: analytics.scoreDistribution['0-59'] },
  ];

  // Prepare student scores for bar chart (top 20)
  const studentScoresData = analytics.studentSubmissions
    .filter((s) => s.grade !== null)
    .slice(0, 20)
    .map((s) => ({
      name: s.studentName.length > 15 ? s.studentName.substring(0, 15) + '...' : s.studentName,
      score: s.grade,
    }));

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
              <button
                onClick={() => router.back()}
                className="mb-4 text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <p className="page-kicker">Instructor workspace</p>
              <h1 className="page-title mt-3 mb-2">
                Assignment Analytics
              </h1>
              <p className="text-ink-muted">
                {analytics.assignment.title} - {analytics.assignment.courseName}
              </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="card rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm mb-1 text-ink-muted">Total Students</p>
                    <p className="text-2xl font-bold text-ink">{analytics.summary.totalStudents}</p>
                  </div>
                  <div className="w-12 h-12 bg-neutral-100 dark:bg-neutral-900/30 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="card rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm mb-1 text-ink-muted">Submissions</p>
                    <p className="text-2xl font-bold text-ink">{analytics.summary.totalSubmissions}</p>
                    <p className="text-xs mt-1 text-ink-muted">
                      {analytics.summary.submissionRate.toFixed(1)}% submission rate
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="card rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm mb-1 text-ink-muted">Average Score</p>
                    <p className="text-2xl font-bold text-ink">
                      {analytics.summary.averageScore.toFixed(1)}%
                    </p>
                    <p className="text-xs mt-1 text-ink-muted">
                      {analytics.summary.gradedSubmissions} graded
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-neutral-100 dark:bg-neutral-900/30 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="card rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm mb-1 text-ink-muted">Pending Grading</p>
                    <p className="text-2xl font-bold text-ink">{analytics.summary.pendingGrading}</p>
                    <p className="text-xs mt-1 text-ink-muted">
                      {analytics.summary.pendingGrading > 0 ? 'Needs attention' : 'All graded'}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Submission Timeline Chart */}
              <div className="card rounded-xl p-6">
                <h2 className="text-xl font-bold mb-4 text-ink">Submission Timeline</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={analytics.submissionTimeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                      stroke={chart.axis}
                    />
                    <YAxis stroke={chart.axis} />
                    <Tooltip
                      labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                      contentStyle={chartTooltipStyle(chart)}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="count" stroke={chart.accent} strokeWidth={2} name="Submissions" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Score Distribution Chart */}
              <div className="card rounded-xl p-6">
                <h2 className="text-xl font-bold mb-4 text-ink">Score Distribution</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scoreDistributionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="range" stroke={chart.axis} />
                    <YAxis stroke={chart.axis} />
                    <Tooltip
                      contentStyle={chartTooltipStyle(chart)}
                    />
                    <Legend />
                    <Bar dataKey="count" name="Students" fill={chart.accent}>
                      {scoreDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Student Scores Bar Chart */}
            {studentScoresData.length > 0 && (
              <div className="card rounded-xl p-6 mb-8">
                <h2 className="text-xl font-bold mb-4 text-ink">Top Student Scores</h2>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={studentScoresData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis type="number" domain={[0, 100]} stroke={chart.axis} />
                    <YAxis dataKey="name" type="category" stroke={chart.axis} width={120} />
                    <Tooltip
                      contentStyle={chartTooltipStyle(chart)}
                      formatter={(value: number) => `${value}%`}
                    />
                    <Legend />
                    <Bar dataKey="score" name="Score (%)" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Student Submissions Table */}
            <div className="card rounded-xl overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-ink">Student Submissions</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="table-orbit w-full">
                  <thead className="">
                    <tr>
                      <th className="px-6 py-3"><span className="sr-only">Grade</span></th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted">
                        Student
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted">
                        Score
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-muted">
                        Submitted At
                      </th>
                    </tr>
                  </thead>
                  <tbody className="">
                    {analytics.studentSubmissions.map((submission) => (
                      <tr key={submission._id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button type="button" className="min-h-[44px] font-semibold text-primary-600 hover:underline" onClick={() => setGrading(grading === submission._id ? null : submission._id)}>
                            {grading === submission._id ? 'Close' : 'Grade'}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">
                          {submission.studentName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-muted">
                          {submission.studentEmail}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                          {submission.grade !== null ? (
                            <span className={`font-semibold ${
                              submission.grade >= 90 ? 'text-green-600' :
                              submission.grade >= 80 ? 'text-primary-600' :
                              submission.grade >= 70 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {submission.grade}%
                            </span>
                          ) : (
                            <span className="text-ink-subtle">Not graded</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            submission.status === 'graded' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            submission.status === 'submitted' ? 'bg-neutral-100 text-neutral-800 dark:bg-neutral-900/30 dark:text-primary-400' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {submission.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-muted">
                          {submission.submittedAt
                            ? format(new Date(submission.submittedAt), 'MMM dd, yyyy HH:mm')
                            : 'N/A'}
                          {submission.late ? ' (late)' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analytics.studentSubmissions.filter((submission) => submission._id === grading).map((submission) => (
                <div key={submission._id} className="border-t border-gray-200 p-4 dark:border-gray-700 sm:p-6">
                  <p className="mb-2 font-semibold text-ink">{submission.studentName}</p>
                  <SubmissionGradeForm assignmentId={assignmentId as string} submission={submission} onSaved={loadAnalytics} />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}









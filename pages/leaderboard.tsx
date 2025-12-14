/**
 * Leaderboard Page
 * Displays rankings by points, course completions, quiz scores, or course-specific progress
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  points?: number;
  completions?: number;
  avgScore?: number;
  totalQuizzes?: number;
  progress?: number;
  avatar?: string;
}

export default function Leaderboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'points' | 'completions' | 'quizzes' | 'course'>('points');
  const [courseId, setCourseId] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated) {
      fetchLeaderboard();
    }
  }, [isAuthenticated, authLoading, type, courseId]);

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('type', type);
      if (type === 'course' && courseId) {
        params.append('courseId', courseId);
      }

      const response = await apiClient.get<LeaderboardEntry[]>(`/leaderboard?${params.toString()}`);
      setLeaderboard(response);
    } catch (error: any) {
      console.error('Fetch leaderboard error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading leaderboard...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const getRankIcon = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const getRankColor = (rank: number) => {
    if (rank === 1) return 'from-yellow-400 to-yellow-600';
    if (rank === 2) return 'from-gray-300 to-gray-500';
    if (rank === 3) return 'from-orange-400 to-orange-600';
    return 'from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800';
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden px-4 sm:px-6 lg:px-8 py-4">
        <div className="mb-4 flex-shrink-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Leaderboard</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">See how you rank against other students</p>
        </div>

        {/* Filter Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 mb-4 flex-shrink-0">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-2">
              {(['points', 'completions', 'quizzes'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                    type === t
                      ? 'bg-primary-600 text-white shadow-lg'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {type === 'course' && (
              <input
                type="text"
                placeholder="Course ID..."
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
              />
            )}
          </div>
        </div>

        {/* Leaderboard Table */}
        {leaderboard.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center flex-1 flex items-center justify-center">
            <p className="text-gray-600 dark:text-gray-400">No rankings available yet</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex-1 flex flex-col">
            <div className="overflow-auto flex-1">
              <table className="w-full min-w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Student</th>
                    {type === 'points' && (
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Points</th>
                    )}
                    {type === 'completions' && (
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Courses Completed</th>
                    )}
                    {type === 'quizzes' && (
                      <>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Avg Score</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Quizzes</th>
                      </>
                    )}
                    {type === 'course' && (
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Progress</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {leaderboard.map((entry) => (
                    <tr
                      key={entry.userId}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                        entry.userId === user.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getRankColor(entry.rank)} flex items-center justify-center font-bold text-white text-sm`}>
                          {getRankIcon(entry.rank)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-full flex items-center justify-center text-white font-bold mr-2 text-xs">
                            {entry.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">
                              {entry.name} {entry.userId === user.id && '(You)'}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{entry.email}</p>
                          </div>
                        </div>
                      </td>
                      {type === 'points' && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-base font-bold text-primary-600 dark:text-primary-400">{entry.points || 0}</span>
                        </td>
                      )}
                      {type === 'completions' && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-base font-bold text-green-600 dark:text-green-400">{entry.completions || 0}</span>
                        </td>
                      )}
                      {type === 'quizzes' && (
                        <>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-base font-bold text-blue-600 dark:text-blue-400">{entry.avgScore || 0}%</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-sm text-gray-600 dark:text-gray-400">{entry.totalQuizzes || 0}</span>
                          </td>
                        </>
                      )}
                      {type === 'course' && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-gradient-to-r from-primary-500 to-secondary-500 h-2 rounded-full"
                                style={{ width: `${entry.progress || 0}%` }}
                              ></div>
                            </div>
                            <span className="text-sm font-bold text-gray-900 dark:text-white">{entry.progress || 0}%</span>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

